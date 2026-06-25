import type { Candle, PatternHit, PatternKind, Swing } from './types.js';
import { findCandleSwings } from './pivots.js';
import { linregXY } from './fit.js';
import { buildScanContext, type ScanContext } from './scanContext.js';
import { detectChannels, detectWedges } from './channels.js';
import { detectCupHandle, detectRoundingBottom } from './cup.js';
import { detectHarmonics } from './harmonics.js';
import { detectDoubleTriple } from './doubles.js';
import { detectGaps } from './gaps.js';

/**
 * Find swing highs and lows with confirmation lookback.
 * A pivot at index i is confirmed when its high/low is the extreme
 * over [i-lookback, i+lookback]. Delegates to the shared pivot engine.
 */
export function findSwings(candles: Candle[], lookback = 3): Swing[] {
  return findCandleSwings(candles, lookback);
}

/**
 * Head & Shoulders: 3 highs, middle higher than other two, neckline = lows between.
 * Inverse: 3 lows, middle lower than other two.
 */
function detectHeadShoulders(swings: Swing[]): PatternHit[] {
  const out: PatternHit[] = [];
  const highs = swings.filter(s => s.kind === 'high');
  const lows = swings.filter(s => s.kind === 'low');

  // Need at least 3 highs and 2 lows between them
  for (let i = 0; i < highs.length - 2; i++) {
    const left = highs[i];
    const head = highs[i + 1];
    const right = highs[i + 2];
    if (head.price <= left.price || head.price <= right.price) continue;

    // Shoulders should be roughly equal (within 5%)
    const shoulderDiff = Math.abs(left.price - right.price) / Math.max(left.price, right.price);
    if (shoulderDiff > 0.05) continue;

    // Find 2 lows: one between left-head, one between head-right (neckline)
    const lhLow = lows.find(l => l.index > left.index && l.index < head.index);
    const hrLow = lows.find(l => l.index > head.index && l.index < right.index);
    if (!lhLow || !hrLow) continue;

    // Neckline = avg of two lows. Target = head height below neckline.
    const neckline = (lhLow.price + hrLow.price) / 2;
    const target = neckline - (head.price - neckline);

    // Confidence based on shoulder symmetry
    const confidence = Math.max(0.5, 1 - shoulderDiff * 10);

    out.push({
      kind: 'head_shoulders',
      confidence,
      points: [
        { ts: left.ts, price: left.price, role: 'left_shoulder' },
        { ts: head.ts, price: head.price, role: 'head' },
        { ts: right.ts, price: right.price, role: 'right_shoulder' },
        { ts: lhLow.ts, price: lhLow.price, role: 'neckline_left' },
        { ts: hrLow.ts, price: hrLow.price, role: 'neckline_right' },
      ],
      target_price: target,
      invalidation_price: head.price,
    });
  }

  // Inverse H&S
  for (let i = 0; i < lows.length - 2; i++) {
    const left = lows[i];
    const head = lows[i + 1];
    const right = lows[i + 2];
    if (head.price >= left.price || head.price >= right.price) continue;

    const shoulderDiff = Math.abs(left.price - right.price) / Math.max(left.price, right.price);
    if (shoulderDiff > 0.05) continue;

    const lhHigh = highs.find(h => h.index > left.index && h.index < head.index);
    const hrHigh = highs.find(h => h.index > head.index && h.index < right.index);
    if (!lhHigh || !hrHigh) continue;

    const neckline = (lhHigh.price + hrHigh.price) / 2;
    const target = neckline + (neckline - head.price);
    const confidence = Math.max(0.5, 1 - shoulderDiff * 10);

    out.push({
      kind: 'inverse_head_shoulders',
      confidence,
      points: [
        { ts: left.ts, price: left.price, role: 'left_shoulder' },
        { ts: head.ts, price: head.price, role: 'head' },
        { ts: right.ts, price: right.price, role: 'right_shoulder' },
        { ts: lhHigh.ts, price: lhHigh.price, role: 'neckline_left' },
        { ts: hrHigh.ts, price: hrHigh.price, role: 'neckline_right' },
      ],
      target_price: target,
      invalidation_price: head.price,
    });
  }

  return out;
}

// Double/triple top-bottom detection moved to doubles.ts (zigzag-based, with
// ATR alignment + depth gates). The original 2%-relative implementation fired
// 6–10 overlapping doubles per real daily chart — see doubles.ts header.

/**
 * Triangles: fit lines to recent highs and lows.
 * Ascending: flat top, rising bottom. Descending: falling top, flat bottom.
 * Symmetric: converging from both sides.
 */
function detectTriangles(swings: Swing[]): PatternHit[] {
  const out: PatternHit[] = [];
  const highs = swings.filter(s => s.kind === 'high').slice(-4);
  const lows = swings.filter(s => s.kind === 'low').slice(-4);
  if (highs.length < 2 || lows.length < 2) return out;

  const linfit = (pts: Swing[]) => linregXY(pts.map((p) => p.index), pts.map((p) => p.price));

  const hi = linfit(highs);
  const lo = linfit(lows);

  // Normalize slopes to % per index for comparison
  const avgPrice = [...highs, ...lows].reduce((a, b) => a + b.price, 0) / (highs.length + lows.length);
  const hiSlopePct = (hi.slope / avgPrice) * 100;
  const loSlopePct = (lo.slope / avgPrice) * 100;
  const flatThreshold = 0.05; // less than 0.05% per candle = flat

  let kind: PatternHit['kind'] | null = null;
  if (Math.abs(hiSlopePct) < flatThreshold && loSlopePct > flatThreshold) kind = 'ascending_triangle';
  else if (Math.abs(loSlopePct) < flatThreshold && hiSlopePct < -flatThreshold) kind = 'descending_triangle';
  else if (hiSlopePct < -flatThreshold && loSlopePct > flatThreshold) kind = 'symmetric_triangle';

  if (!kind) return out;

  // Points: 2 from highs, 2 from lows
  const allPoints = [...highs, ...lows].slice(0, 4).map(s => ({ ts: s.ts, price: s.price, role: s.kind }));
  out.push({
    kind,
    confidence: 0.6,
    points: allPoints,
  });

  return out;
}

/**
 * Bull/bear flag: strong impulse followed by tight consolidation against the trend.
 * Simplified heuristic: look at last N candles for impulse + pullback.
 */
function detectFlags(candles: Candle[]): PatternHit[] {
  const out: PatternHit[] = [];
  const n = candles.length;
  if (n < 20) return out;

  const impulseWindow = 10;
  const flagWindow = 10;
  if (n < impulseWindow + flagWindow) return out;

  const impulseStart = n - impulseWindow - flagWindow;
  const impulseEnd = n - flagWindow;
  const flagStart = impulseEnd;
  const flagEnd = n - 1;

  const impMove = (candles[impulseEnd].close - candles[impulseStart].close) / candles[impulseStart].close;
  if (Math.abs(impMove) < 0.05) return out; // need >5% move

  // Flag should pull back 20-50% of impulse
  const flagMove = (candles[flagEnd].close - candles[flagStart].close) / candles[flagStart].close;

  if (impMove > 0 && flagMove < 0 && Math.abs(flagMove / impMove) < 0.5) {
    out.push({
      kind: 'bull_flag',
      confidence: 0.55,
      points: [
        { ts: candles[impulseStart].timestamp, price: candles[impulseStart].close, role: 'impulse_start' },
        { ts: candles[impulseEnd].timestamp, price: candles[impulseEnd].close, role: 'impulse_end' },
        { ts: candles[flagEnd].timestamp, price: candles[flagEnd].close, role: 'flag_end' },
      ],
      target_price: candles[impulseEnd].close * (1 + Math.abs(impMove)),
    });
  } else if (impMove < 0 && flagMove > 0 && Math.abs(flagMove / impMove) < 0.5) {
    out.push({
      kind: 'bear_flag',
      confidence: 0.55,
      points: [
        { ts: candles[impulseStart].timestamp, price: candles[impulseStart].close, role: 'impulse_start' },
        { ts: candles[impulseEnd].timestamp, price: candles[impulseEnd].close, role: 'impulse_end' },
        { ts: candles[flagEnd].timestamp, price: candles[flagEnd].close, role: 'flag_end' },
      ],
      target_price: candles[impulseEnd].close * (1 - Math.abs(impMove)),
    });
  }

  return out;
}

/**
 * Detect all patterns in the candle series.
 *
 * Contract for every detector: emit the pattern's most recent structural
 * touch as one of its points — thesis' recency gate (and selectRecentPatterns)
 * reads max(points.ts) to decide whether a pattern still speaks to the
 * current price.
 */
export function detectPatterns(candles: Candle[], lookback = 3): PatternHit[] {
  if (candles.length < 10) return [];
  // One ScanContext per scan: shared ATR(14), swings, zigzag, suffix extrema.
  const ctx = buildScanContext(candles, lookback);
  const swings = ctx.swings;
  // Geometric detectors consume zigzag swings (structure, not 3-bar blips).
  const zz = ctx.zigzag;
  const lastAtr = ctx.lastAtr;
  // Cup & handle is the more specific basin structure — when it fires, the
  // rounding-bottom detector stays quiet (one structure, one signal).
  const cup = detectCupHandle(candles, zz, lastAtr);
  const rounding = cup.length ? [] : detectRoundingBottom(candles, zz, lastAtr);
  const hits = [
    ...detectHeadShoulders(swings),
    ...detectDoubleTriple(candles, zz, lastAtr),
    ...detectTriangles(swings),
    ...detectFlags(candles),
    ...detectChannels(candles, zz, lastAtr),
    ...detectWedges(candles, zz, lastAtr),
    ...cup,
    ...rounding,
    ...detectHarmonics(candles, zz, lastAtr),
    ...detectGaps(candles, ctx),
  ];
  return hits.filter((h) => BREACH_EXEMPT.has(h.kind) || !breachedSinceCompletion(h, candles, ctx));
}

/**
 * Sloped-envelope kinds are exempt from the breach guard: their target and
 * invalidation are LINE values frozen at one x (the window end), so comparing
 * historical bars against that scalar false-kills live structures — in a
 * channel_up, lowerAt(end) is the band's maximum and every earlier bar
 * "breaches" it; in a falling wedge, bars after the last pivot keep sliding
 * inside the wedge below lowerAt(end). Channels are additionally covered by
 * their close-containment gate over the whole suffix window. (Honest residual:
 * a wedge whose breakout already ran to target can still be reported — the
 * proper fix is a sloped-line breach check, not a scalar one.)
 */
const BREACH_EXEMPT: ReadonlySet<PatternKind> = new Set([
  'channel_up',
  'channel_down',
  'channel_flat',
  'rising_wedge',
  'falling_wedge',
]);

/**
 * Historical Breach Guard — kills zombie patterns.
 *
 * A lastClose-only liveness check is blind to the road in between: a pattern
 * whose invalidation level was breached — or whose target was already tagged —
 * by ANY candle after the pattern completed is consumed, even if price later
 * drifted back into the live band. (Real case: TSLA daily iH&S, invalidation
 * 381.40, completed 2026-03-13; price traded 378.73 six days later, then
 * crashed to 330, then recovered to 399 — the engine reported the setup as
 * live months after it would have stopped a real trade out.)
 *
 * The side each level sits on is inferred from the completion bar's close, so
 * one check covers bullish and bearish structures. Touch semantics on purpose:
 * a stop at the invalidation level fills on a wick, and so does a limit order
 * parked at the target.
 *
 * With a ScanContext the scan is two O(1) suffix-extrema comparisons per
 * level ("did any later bar trade beyond X?" ≡ suffix min/max vs X) — the
 * exact boolean the per-bar loop computes. Without one (external callers,
 * tests) the original loop runs verbatim.
 */
export function breachedSinceCompletion(
  hit: PatternHit,
  candles: Candle[],
  ctx?: ScanContext,
): boolean {
  const inv = hit.invalidation_price;
  const tgt = hit.target_price;
  if ((inv === undefined && tgt === undefined) || hit.points.length === 0) return false;

  // Completion bar = the candle holding the rightmost structural anchor.
  const completionTs = Math.max(...hit.points.map((p) => p.ts));
  let idx = -1;
  if (ctx) {
    idx = ctx.lastIndexAtOrBefore(completionTs);
  } else {
    for (let i = candles.length - 1; i >= 0; i--) {
      if (candles[i].timestamp <= completionTs) {
        idx = i;
        break;
      }
    }
  }
  if (idx < 0) return false;
  const ref = candles[idx].close;

  if (ctx) {
    const from = idx + 1;
    const minLow = ctx.suffixMinLow[from];
    const maxHigh = ctx.suffixMaxHigh[from];
    if (inv !== undefined && (inv < ref ? minLow <= inv : maxHigh >= inv)) return true;
    if (tgt !== undefined && (tgt > ref ? maxHigh >= tgt : minLow <= tgt)) return true;
    return false;
  }

  for (let i = idx + 1; i < candles.length; i++) {
    const c = candles[i];
    if (inv !== undefined && (inv < ref ? c.low <= inv : c.high >= inv)) return true;
    if (tgt !== undefined && (tgt > ref ? c.high >= tgt : c.low <= tgt)) return true;
  }
  return false;
}

/**
 * Patterns whose latest point falls within the final `recentFraction` of the
 * series — the same recency rule thesis.ts applies before weighing a pattern.
 * Shared so "what thesis considers live" and "what tools offer to draw" agree.
 */
export function selectRecentPatterns(
  patterns: PatternHit[],
  firstTs: number,
  lastTs: number,
  recentFraction = 0.25,
): PatternHit[] {
  const span = lastTs - firstTs;
  const cut = span > 0 ? lastTs - recentFraction * span : -Infinity;
  return patterns.filter((p) => {
    const latest = p.points.length ? Math.max(...p.points.map((pt) => pt.ts)) : 0;
    return latest >= cut;
  });
}
