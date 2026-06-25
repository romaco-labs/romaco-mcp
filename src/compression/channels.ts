import type { Candle, PatternHit, Swing } from './types.js';
import { linregXY, type LineFit } from './fit.js';
import { findCandleSwings, minReversalFromAtr, zigzagFilter } from './pivots.js';
import { atr as atrSeries } from './volatility.js';

/**
 * Parallel-channel detection on zigzag swings.
 *
 * Honest-signal contract: every gate below must pass or NO hit is emitted —
 * noise produces zero hits, never a low-confidence hit. Confidence only
 * grades channels that already cleared every structural test.
 */

// ── Gates ───────────────────────────────────────────────────────────────────
// Calibrated against BOTH synthetic fixtures and real data (AAPL 1h, SPY/GLD
// 1d windows, 2026-06): a clean channel scores touches 6+5 / band-usage 0.24 /
// close-r² 0.94; trendy-but-not-channel real windows score touches 1+1..2+1 /
// usage 0.08–0.18 because ONE outlier swing defines the envelope; seeded
// random chop scores usage 0.13 with height ≈ 2 ATR.
/** Minimum candles between the first and last swing of the structure. */
const CH_MIN_SPAN = 30;
/** Fit at most this many of the most recent zigzag swings per side. */
const CH_MAX_SWINGS_PER_SIDE = 6;
/** A channel narrower than this is indistinguishable from noise. */
const CH_MIN_HEIGHT_ATR = 1.5;
/** Flat channels clear a HIGHER height bar: a trending channel is confirmed by
 *  its slope, but a flat one's only signal is fade-the-edges — a band under
 *  ~2.5 ATR is one candle's noise away from either edge, not structure. */
const CH_MIN_HEIGHT_ATR_FLAT = 2.5;
/** A "channel" wider than this fraction of price is a regime, not a structure. */
const CH_MAX_HEIGHT_PCT = 0.12;
/** A swing "touches" its envelope line when within this fraction of the height. */
const CH_TOUCH_TOL_HEIGHT_FRAC = 0.2;
/** Closes may overshoot the envelope by at most this fraction of the height
 *  (the envelope is built from confirmed swings; unconfirmed terminal spikes
 *  may poke slightly, a regime break may not). */
const CH_CLOSE_BREAK_HEIGHT_FRAC = 0.15;
/** Mid-slope below this (%/candle) = flat channel (same constant as triangles). */
const CH_FLAT_SLOPE_PCT = 0.05;
/** Trending channels: regression on closes must explain the move this well. */
const CH_MIN_CLOSE_R2 = 0.55;
/** Price must actually TRAVEL the band: mean |close − midline| / height. A
 *  trend hugging its midline (usage ≈ 0.08–0.10) is a trend, not a channel;
 *  seeded random chop measures 0.13; REAL touch-qualified channels (AAPL/KO
 *  1d, 60-candle windows) measure 0.16–0.17; the clean fixture 0.24. */
const CH_MIN_USAGE = 0.15;
/** Confirmed envelope tests required: this many touches on one line… */
const CH_TOUCHES_PRIMARY = 3;
/** …and this many on the other. */
const CH_TOUCHES_SECONDARY = 2;
/** (Wedges) a swing touches its fitted line when within this many ATRs. */
const CH_TOUCH_TOL_ATR = 0.3;
/** Suffix windows scanned for a channel (0 = the whole series). A channel is
 *  usually a RECENT sub-structure; the global zigzag (sized by whole-series
 *  ATR) coarsens away the fine recent swings, so shorter suffixes re-derive
 *  their own swing structure. Gates are identical per window; the highest
 *  confidence survivor wins. */
const CH_WINDOWS = [0, 130, 60];

const fitAt = (f: LineFit, x: number): number => f.slope * x + f.intercept;

export interface TwoLineFit {
  hi: LineFit;
  lo: LineFit;
  hiSwings: Swing[];
  loSwings: Swing[];
  hiTouches: Swing[];
  loTouches: Swing[];
  startIdx: number;
  endIdx: number;
  /** Candle index of the most recent touch on either line. */
  lastTouchIdx: number;
}

/**
 * Fit independent regression lines through the last `maxPerSide` zigzag highs
 * and lows, and classify which swings genuinely touch their line.
 * Returns null when either side has fewer than 2 swings (no line possible).
 */
export function fitTwoLines(zz: Swing[], maxPerSide: number, touchTol: number): TwoLineFit | null {
  const hiSwings = zz.filter((s) => s.kind === 'high').slice(-maxPerSide);
  const loSwings = zz.filter((s) => s.kind === 'low').slice(-maxPerSide);
  if (hiSwings.length < 2 || loSwings.length < 2) return null;

  const hi = linregXY(hiSwings.map((s) => s.index), hiSwings.map((s) => s.price));
  const lo = linregXY(loSwings.map((s) => s.index), loSwings.map((s) => s.price));

  const hiTouches = hiSwings.filter((s) => Math.abs(s.price - fitAt(hi, s.index)) <= touchTol);
  const loTouches = loSwings.filter((s) => Math.abs(s.price - fitAt(lo, s.index)) <= touchTol);

  const all = [...hiSwings, ...loSwings];
  const startIdx = Math.min(...all.map((s) => s.index));
  const endIdx = Math.max(...all.map((s) => s.index));
  const touched = [...hiTouches, ...loTouches];
  const lastTouchIdx = touched.length ? Math.max(...touched.map((s) => s.index)) : -1;

  return { hi, lo, hiSwings, loSwings, hiTouches, loTouches, startIdx, endIdx, lastTouchIdx };
}

/**
 * Detect at most one parallel channel over the most recent swing structure.
 *
 * Regression-channel construction: one least-squares line through the CLOSES
 * is the midline; the envelope is that line offset up/down through the most
 * extreme swing on each side. The lines are parallel by construction — the
 * honesty lives in the gates: enough swings must TOUCH both envelope lines,
 * price must genuinely travel the band (usage), the closes-fit must explain a
 * trending move (r²), and the band must clear noise (height vs ATR).
 *
 * (Fitting separate lines to swing highs/lows — the previous approach — fails
 * on real data: a least-squares line through scattered pivots passes through
 * their MIDDLE, so "touch the line" tests reject every genuine channel.)
 *
 * Targets are honest: ride to the opposite band, invalidate on the near band.
 * NOT a breakout projection — an unbroken line is not a measured-move signal.
 */
export function detectChannels(candles: Candle[], zz: Swing[], atr: number): PatternHit[] {
  if (atr <= 0 || candles.length < CH_MIN_SPAN) return [];

  let best: PatternHit | null = null;
  for (const w of CH_WINDOWS) {
    let hit: PatternHit | null;
    if (w === 0 || w >= candles.length) {
      hit = detectChannelInWindow(candles, zz, atr);
    } else {
      const slice = candles.slice(-w);
      const localZz = zigzagFilter(findCandleSwings(slice), minReversalFromAtr(slice));
      hit = detectChannelInWindow(slice, localZz, lastFiniteAtr(slice) || atr);
    }
    if (hit && (!best || hit.confidence > best.confidence)) best = hit;
  }
  return best ? [best] : [];
}

function lastFiniteAtr(candles: Candle[]): number {
  const series = atrSeries(candles);
  for (let i = series.length - 1; i >= 0; i--) {
    if (!Number.isNaN(series[i]) && series[i] > 0) return series[i];
  }
  return 0;
}

/** One gate-everything attempt over one candle window. Points carry real
 *  timestamps, so windowed hits need no index translation. */
function detectChannelInWindow(candles: Candle[], zz: Swing[], atr: number): PatternHit | null {
  if (atr <= 0 || candles.length < CH_MIN_SPAN) return null;

  const hiSwings = zz.filter((s) => s.kind === 'high').slice(-CH_MAX_SWINGS_PER_SIDE);
  const loSwings = zz.filter((s) => s.kind === 'low').slice(-CH_MAX_SWINGS_PER_SIDE);
  if (hiSwings.length < 2 || loSwings.length < 2) return null;

  const all = [...hiSwings, ...loSwings];
  const startIdx = Math.min(...all.map((s) => s.index));
  const endIdx = Math.max(...all.map((s) => s.index));
  const span = endIdx - startIdx;
  if (span < CH_MIN_SPAN) return null;

  // Midline through the closes of the structure.
  const xs: number[] = [];
  const ys: number[] = [];
  for (let i = startIdx; i <= endIdx; i++) {
    xs.push(i);
    ys.push(candles[i].close);
  }
  const mid = linregXY(xs, ys);

  // Envelope: parallel lines through the most extreme swing on each side.
  const offUp = Math.max(...hiSwings.map((s) => s.price - fitAt(mid, s.index)));
  const offDn = Math.max(...loSwings.map((s) => fitAt(mid, s.index) - s.price));
  if (offUp <= 0 || offDn <= 0) return null; // swings on the wrong side of the midline = no band
  const height = offUp + offDn;
  const lastClose = candles[candles.length - 1].close;
  if (height < CH_MIN_HEIGHT_ATR * atr || height > CH_MAX_HEIGHT_PCT * lastClose) return null;

  // Touch counts vs the ENVELOPE lines (3+2 confirmed tests minimum). One
  // touch per side is guaranteed by construction; a channel needs repetition.
  const tol = CH_TOUCH_TOL_HEIGHT_FRAC * height;
  const hiTouches = hiSwings.filter((s) => Math.abs(s.price - (fitAt(mid, s.index) + offUp)) <= tol);
  const loTouches = loSwings.filter((s) => Math.abs(s.price - (fitAt(mid, s.index) - offDn)) <= tol);
  const t1 = hiTouches.length;
  const t2 = loTouches.length;
  const touchesOk =
    (t1 >= CH_TOUCHES_PRIMARY && t2 >= CH_TOUCHES_SECONDARY) ||
    (t2 >= CH_TOUCHES_PRIMARY && t1 >= CH_TOUCHES_SECONDARY);
  if (!touchesOk) return null;
  const lastTouchIdx = Math.max(...[...hiTouches, ...loTouches].map((s) => s.index));

  // Band usage + containment in one pass: price must travel the band, and no
  // close may sit beyond the envelope by more than the break fraction.
  let absDev = 0;
  for (let i = startIdx; i <= endIdx; i++) {
    const c = candles[i].close;
    const m = fitAt(mid, i);
    if (c > m + offUp + CH_CLOSE_BREAK_HEIGHT_FRAC * height) return null;
    if (c < m - offDn - CH_CLOSE_BREAK_HEIGHT_FRAC * height) return null;
    absDev += Math.abs(c - m);
  }
  const usage = absDev / (span + 1) / height;
  if (usage < CH_MIN_USAGE) return null;

  // Classification by midline slope in %/candle.
  const midSlopePct = (mid.slope / fitAt(mid, endIdx)) * 100;
  const trending = Math.abs(midSlopePct) >= CH_FLAT_SLOPE_PCT;
  if (trending && mid.r2 < CH_MIN_CLOSE_R2) return null;

  const kind: PatternHit['kind'] =
    midSlopePct >= CH_FLAT_SLOPE_PCT ? 'channel_up' : midSlopePct <= -CH_FLAT_SLOPE_PCT ? 'channel_down' : 'channel_flat';
  if (kind === 'channel_flat' && height < CH_MIN_HEIGHT_ATR_FLAT * atr) return null;

  // Confidence: floor 0.5 (every gate passed), cap 0.85 (a pattern is never certainty).
  const confidence = Math.min(
    0.85,
    0.5 +
      0.04 * Math.min(Math.max(t1 + t2 - 5, 0), 3) +
      (trending ? 0.15 * mid.r2 : 0.075) +
      0.4 * Math.min(Math.max(usage - CH_MIN_USAGE, 0), 0.15),
  );

  // Envelope evaluators. Base line = trend-side line (the one price rides):
  // lower for up/flat, upper for down.
  const upperAt = (x: number): number => fitAt(mid, x) + offUp;
  const lowerAt = (x: number): number => fitAt(mid, x) - offDn;
  const baseAt = kind === 'channel_down' ? upperAt : lowerAt;
  const otherAt = kind === 'channel_down' ? lowerAt : upperAt;
  const ts = (i: number): number => candles[i].timestamp;

  const points: PatternHit['points'] = [
    { ts: ts(startIdx), price: baseAt(startIdx), role: 'base_start' },
    { ts: ts(lastTouchIdx), price: baseAt(lastTouchIdx), role: 'base_end' },
    { ts: ts(startIdx), price: otherAt(startIdx), role: 'offset' },
  ];
  // Touch evidence (capped) — includes the most recent touch, which is what
  // the thesis/select recency gates read via max(points.ts).
  for (const s of [...hiTouches].slice(-3)) points.push({ ts: s.ts, price: s.price, role: 'upper_touch' });
  for (const s of [...loTouches].slice(-3)) points.push({ ts: s.ts, price: s.price, role: 'lower_touch' });

  // Ride to the far band, die on the near band (relative to the trade the
  // channel suggests). Flat: far band from the last close.
  let target: number;
  let invalidation: number;
  if (kind === 'channel_up') {
    target = upperAt(endIdx);
    invalidation = lowerAt(endIdx);
  } else if (kind === 'channel_down') {
    target = lowerAt(endIdx);
    invalidation = upperAt(endIdx);
  } else {
    const center = fitAt(mid, endIdx);
    target = lastClose <= center ? upperAt(endIdx) : lowerAt(endIdx);
    invalidation = lastClose <= center ? lowerAt(endIdx) : upperAt(endIdx);
  }

  return {
    kind,
    confidence,
    points,
    target_price: target,
    invalidation_price: invalidation,
  };
}

// ── Wedges ──────────────────────────────────────────────────────────────────
/** Minimum candles across the wedge structure. */
const WG_MIN_SPAN = 15;
/** Both lines must slope at least this much (%/candle), in the SAME direction. */
const WG_MIN_SLOPE_PCT = 0.05;
/** End gap must shrink to at most this fraction of the start gap. */
const WG_CONVERGE_RATIO = 0.7;
/** The projected apex may sit at most this many spans beyond the structure
 *  (converging slower = channel; apex inside the data = crossed lines = garbage). */
const WG_APEX_MAX_SPANS = 4;
/** Both lines must fit their swings at least this well. */
const WG_MIN_R2 = 0.5;
/** Confirmed touches per line. */
const WG_MIN_TOUCHES_PER_SIDE = 2;
/** Per-side RMS residual cap as a fraction of the mean gap — same honesty
 *  discriminator as channels: a real wedge's pivots ARE its lines; a noisy
 *  trend drapes lines over scattered pivots (residuals ~20-30% of the gap). */
const WG_MAX_RMS_RESID_GAP_FRAC = 0.12;

/**
 * Rising wedge (bearish: both lines up, floor steeper, range squeezing) and
 * falling wedge (bullish mirror). Mutually exclusive with triangles (those
 * need one flat or opposite-sign lines) and channels (those need parallel
 * lines) by construction — no arbitration required.
 */
export function detectWedges(candles: Candle[], zz: Swing[], atr: number): PatternHit[] {
  if (atr <= 0 || candles.length < WG_MIN_SPAN) return [];

  const fit = fitTwoLines(zz, CH_MAX_SWINGS_PER_SIDE, CH_TOUCH_TOL_ATR * atr);
  if (!fit) return [];
  const { hi, lo, hiTouches, loTouches, startIdx, endIdx, lastTouchIdx } = fit;

  const span = endIdx - startIdx;
  if (span < WG_MIN_SPAN) return [];
  if (hiTouches.length < WG_MIN_TOUCHES_PER_SIDE || loTouches.length < WG_MIN_TOUCHES_PER_SIDE) return [];
  if (lastTouchIdx < 0) return [];
  if (Math.min(hi.r2, lo.r2) < WG_MIN_R2) return [];

  // Slopes: same sign, both meaningful.
  const avgPrice = (fitAt(hi, endIdx) + fitAt(lo, endIdx)) / 2;
  const hiSlopePct = (hi.slope / avgPrice) * 100;
  const loSlopePct = (lo.slope / avgPrice) * 100;
  let kind: PatternHit['kind'];
  if (hiSlopePct > WG_MIN_SLOPE_PCT && loSlopePct > WG_MIN_SLOPE_PCT && lo.slope > hi.slope) {
    kind = 'rising_wedge'; // floor climbs faster than the ceiling → squeeze upward
  } else if (hiSlopePct < -WG_MIN_SLOPE_PCT && loSlopePct < -WG_MIN_SLOPE_PCT && hi.slope < lo.slope) {
    kind = 'falling_wedge'; // ceiling falls faster than the floor → squeeze downward
  } else {
    return [];
  }

  // Convergence without crossing inside the data.
  const gapStart = fitAt(hi, startIdx) - fitAt(lo, startIdx);
  const gapEnd = fitAt(hi, endIdx) - fitAt(lo, endIdx);
  if (gapStart <= 0 || gapEnd <= 0) return [];
  if (gapEnd > WG_CONVERGE_RATIO * gapStart) return [];

  // Line precision: the defining pivots must sit on their lines.
  const meanGap = (gapStart + gapEnd) / 2;
  const rms = (swings: Swing[], f: LineFit): number =>
    Math.sqrt(swings.reduce((s, p) => s + (p.price - fitAt(f, p.index)) ** 2, 0) / swings.length);
  if (rms(fit.hiSwings, hi) > WG_MAX_RMS_RESID_GAP_FRAC * meanGap) return [];
  if (rms(fit.loSwings, lo) > WG_MAX_RMS_RESID_GAP_FRAC * meanGap) return [];

  // Apex sanity: lines must meet soon after the structure, not inside it.
  const slopeDiff = hi.slope - lo.slope; // negative for both wedge kinds (converging)
  if (slopeDiff >= 0) return [];
  const apexIdx = startIdx + gapStart / -slopeDiff;
  if (apexIdx <= endIdx || apexIdx > endIdx + WG_APEX_MAX_SPANS * span) return [];

  const touches = hiTouches.length + loTouches.length;
  const confidence = Math.min(
    0.85,
    0.5 +
      0.15 * Math.min(hi.r2, lo.r2) +
      0.1 * Math.max(0, Math.min(1, (1 - gapEnd / gapStart - (1 - WG_CONVERGE_RATIO)) / WG_CONVERGE_RATIO)) +
      0.04 * Math.max(0, touches - 4),
  );

  const ts = (i: number): number => candles[i].timestamp;
  const points: PatternHit['points'] = [
    { ts: ts(startIdx), price: fitAt(hi, startIdx), role: 'upper_start' },
    { ts: ts(endIdx), price: fitAt(hi, endIdx), role: 'upper_end' },
    { ts: ts(startIdx), price: fitAt(lo, startIdx), role: 'lower_start' },
    { ts: ts(endIdx), price: fitAt(lo, endIdx), role: 'lower_end' },
  ];
  for (const s of [...hiTouches].slice(-2)) points.push({ ts: s.ts, price: s.price, role: 'upper_touch' });
  for (const s of [...loTouches].slice(-2)) points.push({ ts: s.ts, price: s.price, role: 'lower_touch' });
  // Recency contract: the most recent touch must be visible to max(points.ts).
  const lastTouch = [...hiTouches, ...loTouches].sort((a, b) => a.index - b.index).pop();
  if (lastTouch && !points.some((p) => p.ts === lastTouch.ts)) {
    points.push({ ts: lastTouch.ts, price: lastTouch.price, role: `${lastTouch.kind === 'high' ? 'upper' : 'lower'}_touch` });
  }

  // Conventional wedge resolution: retreat to the structure's base.
  const target = kind === 'rising_wedge' ? fitAt(lo, startIdx) : fitAt(hi, startIdx);
  const invalidation = kind === 'rising_wedge' ? fitAt(hi, endIdx) : fitAt(lo, endIdx);

  return [{
    kind,
    confidence,
    points,
    target_price: target,
    invalidation_price: invalidation,
  }];
}
