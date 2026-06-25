import type { Candle } from '../../src/compression/types.js';

/**
 * Synthetic candle generators for deterministic testing.
 */

const BASE_TS = 1_700_000_000;
const TF = 3600; // 1h

/** Linear uptrend: start at startPrice, gain pricePerStep per candle. */
export function uptrendCandles(n: number, startPrice = 100, pricePerStep = 1, noise = 0): Candle[] {
  const out: Candle[] = [];
  for (let i = 0; i < n; i++) {
    const open = startPrice + i * pricePerStep + (i % 2 === 0 ? noise : -noise);
    const close = startPrice + (i + 1) * pricePerStep + (i % 3 === 0 ? noise : -noise);
    const high = Math.max(open, close) + Math.abs(noise);
    const low = Math.min(open, close) - Math.abs(noise);
    out.push({
      timestamp: BASE_TS + i * TF,
      open, high, low, close,
      volume: 1000 + i * 10,
    });
  }
  return out;
}

/** Linear downtrend. */
export function downtrendCandles(n: number, startPrice = 200, pricePerStep = 1, noise = 0): Candle[] {
  return uptrendCandles(n, startPrice, -pricePerStep, noise);
}

/** Sideways: small random walk around basePrice. */
export function sidewaysCandles(n: number, basePrice = 100, range = 1): Candle[] {
  const out: Candle[] = [];
  let seed = 42;
  const rng = () => {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    return (seed / 0x7fffffff) * 2 - 1;
  };
  for (let i = 0; i < n; i++) {
    const open = basePrice + rng() * range;
    const close = basePrice + rng() * range;
    const high = Math.max(open, close) + Math.abs(rng()) * range;
    const low = Math.min(open, close) - Math.abs(rng()) * range;
    out.push({
      timestamp: BASE_TS + i * TF,
      open, high, low, close,
      volume: 1000,
    });
  }
  return out;
}

/** Head & Shoulders: 3 highs, middle higher, with valleys between. */
export function headShouldersCandles(): Candle[] {
  const prices = [
    100, 102, 105, 110, 115, 113, 110, 107, 105,   // left shoulder up
    100, 95, 100, 105, 110, 115, 120, 125, 128, 130, // up to head
    125, 120, 115, 110, 105,                         // down from head
    108, 112, 115, 113, 110, 107, 105, 100, 95, 90  // right shoulder + breakdown
  ];
  return prices.map((p, i) => ({
    timestamp: BASE_TS + i * TF,
    open: p, high: p + 0.5, low: p - 0.5, close: p,
    volume: 1000,
  }));
}

/** Double top IN FORMATION: two peaks at similar level with a valley between,
 *  price still inside the neckline↔tops band (the pattern is live — a
 *  completed breakdown would be a stale signal and the detector skips those).
 *  The drift tail also keeps top_2 OUTSIDE the recency window, which the
 *  draw_pattern staleness test relies on. */
export function doubleTopCandles(): Candle[] {
  const prices = [
    100, 105, 110, 115, 120,        // up
    118, 115, 110, 105, 100,        // down to the valley (neckline)
    105, 110, 115, 118, 120,        // back up — second test of the top
    115, 112, 113, 112, 113, 112,   // rejection, drifting inside the band
  ];
  return prices.map((p, i) => ({
    timestamp: BASE_TS + i * TF,
    open: p, high: p + 0.5, low: p - 0.5, close: p,
    volume: 1000,
  }));
}

/** Bullish divergence on RSI: price lower-low, indicator higher-low. */
export function bullishDivergenceCandles(): Candle[] {
  // First decline followed by smaller second decline (RSI should print higher low)
  const prices: number[] = [];
  // First low at index ~10
  for (let i = 0; i < 5; i++) prices.push(100 - i * 2);     // 100 → 92
  for (let i = 0; i < 8; i++) prices.push(90 + i * 0.5);    // pump back up
  // Second low at index ~20: lower price but RSI bounces
  for (let i = 0; i < 6; i++) prices.push(94 - i * 1.5);    // dump to 85 (lower than 92)
  for (let i = 0; i < 5; i++) prices.push(85 + i * 1);      // recover
  return prices.map((p, i) => ({
    timestamp: BASE_TS + i * TF,
    open: p, high: p + 0.5, low: p - 0.5, close: p,
    volume: 1000,
  }));
}

/**
 * Clean parallel channel: a linear mid-trend plus a deterministic triangle-wave
 * oscillation. Swing highs land exactly on the upper line, lows on the lower —
 * a textbook channel for the detector's positive cases.
 */
export function channelCandles(n = 60, start = 100, slope = 0.5, amp = 3, period = 10): Candle[] {
  const out: Candle[] = [];
  for (let i = 0; i < n; i++) {
    const phase = (i % period) / period;
    const tri = phase < 0.5 ? 4 * phase - 1 : 3 - 4 * phase; // −1 → +1 → −1
    const close = start + slope * i + amp * tri;
    const prev = i === 0 ? close : out[i - 1].close;
    // Open at the midpoint so the candle after a peak/trough never TIES the
    // extreme's high/low — strict pivot detection needs a unique extreme.
    const open = (prev + close) / 2;
    out.push({
      timestamp: BASE_TS + i * TF,
      open,
      high: Math.max(open, close) + 0.3,
      low: Math.min(open, close) - 0.3,
      close,
      volume: 1000,
    });
  }
  return out;
}

export const channelUpCandles = (n = 60): Candle[] => channelCandles(n, 100, 0.5, 3, 10);
export const channelDownCandles = (n = 60): Candle[] => channelCandles(n, 200, -0.5, 3, 10);
export const flatRangeCandles = (n = 60): Candle[] => channelCandles(n, 100, 0, 3, 10);

/**
 * Wedge: price zigzags between two converging same-direction lines.
 * Rising: floor climbs faster than the ceiling (bearish squeeze).
 * Peaks/troughs land exactly on the lines (deterministic 0→1→0 weight wave).
 */
export function wedgeCandles(
  n = 50,
  start = 100,
  lowerSlope = 0.5,
  upperSlope = 0.3,
  startGap = 16,
  period = 8,
): Candle[] {
  const out: Candle[] = [];
  for (let i = 0; i < n; i++) {
    const lower = start + lowerSlope * i;
    const upper = start + startGap + upperSlope * i;
    const phase = (i % period) / period;
    const w = phase < 0.5 ? 2 * phase : 2 - 2 * phase; // 0 → 1 → 0
    const close = lower + (upper - lower) * w;
    const prev = i === 0 ? close : out[i - 1].close;
    const open = (prev + close) / 2;
    out.push({
      timestamp: BASE_TS + i * TF,
      open,
      high: Math.max(open, close) + 0.3,
      low: Math.min(open, close) - 0.3,
      close,
      volume: 1000,
    });
  }
  return out;
}

export const risingWedgeCandles = (n = 50): Candle[] => wedgeCandles(n, 100, 0.5, 0.3, 16, 8);
export const fallingWedgeCandles = (n = 50): Candle[] => wedgeCandles(n, 200, -0.3, -0.5, 16, 8);

/**
 * Cup & handle: ramp to the left rim (120), parabolic basin to 100 over 40
 * bars, right rim ≈119.8, then an 8-bar handle dipping to ~114 and recovering
 * to ~119. Deterministic; lows trace the parabola exactly.
 */
export function cupHandleCandles(): Candle[] {
  const closes: number[] = [];
  // Ramp up to the left rim so it confirms as a swing high.
  closes.push(110, 113, 116, 120);
  const L = 3;
  const span = 40;
  const depth = 20;
  // Parabola: low(i) = 120 − depth·(1 − ((i−L−span/2)/(span/2))²) ... inverted:
  // bottom at the midpoint, rims at the ends.
  for (let k = 1; k <= span; k++) {
    const x = (k - span / 2) / (span / 2); // −1+ → +1
    const lowLine = 120 - depth * (1 - x * x);
    closes.push(k === span ? 119.8 : lowLine + 0.4);
  }
  // Handle: dip to ~114, recover to 119.
  closes.push(118, 116.5, 115, 114.2, 115.5, 117, 118.2, 119);
  void L;
  const out: Candle[] = [];
  for (let i = 0; i < closes.length; i++) {
    const close = closes[i];
    const prev = i === 0 ? close : closes[i - 1];
    const open = (prev + close) / 2;
    out.push({
      timestamp: BASE_TS + i * TF,
      open,
      high: Math.max(open, close) + 0.2,
      low: Math.min(open, close) - 0.4,
      close,
      volume: 1000,
    });
  }
  return out;
}

/**
 * NEGATIVE: sharp V-bottom of comparable depth/width. Fits a parabola
 * decently (r² ≈ .95) but spends almost no time near the bottom — the basin
 * gate must reject it.
 */
export function vBottomCandles(): Candle[] {
  const closes: number[] = [110, 113, 116, 120];
  const half = 20;
  for (let k = 1; k <= half; k++) closes.push(120 - k); // straight down to 100
  for (let k = 1; k <= half; k++) closes.push(100 + k * 0.99); // straight back up
  closes.push(118, 116.5, 115, 114.2, 115.5, 117, 118.2, 119); // same handle shape
  const out: Candle[] = [];
  for (let i = 0; i < closes.length; i++) {
    const close = closes[i];
    const prev = i === 0 ? close : closes[i - 1];
    const open = (prev + close) / 2;
    out.push({
      timestamp: BASE_TS + i * TF,
      open,
      high: Math.max(open, close) + 0.2,
      low: Math.min(open, close) - 0.4,
      close,
      volume: 1000,
    });
  }
  return out;
}

/** NEGATIVE: a perfect cup with NO handle (series ends at the right rim). */
export function cupNoHandleCandles(): Candle[] {
  const full = cupHandleCandles();
  return full.slice(0, 4 + 40 + 1); // ramp + cup + the rim candle, nothing after
}

/**
 * Rounding bottom: 5 flat lead bars at the rim, a 50-bar parabolic basin
 * (rim 120 → bottom 100 → rim 120), then a 4-bar drift at ~114 — recovery
 * underway (≥60% of depth above the bottom) but NOT past the rim (live).
 */
export function roundingBottomCandles(): Candle[] {
  const lows: number[] = [];
  for (let k = 0; k < 5; k++) lows.push(119.5);
  for (let k = 0; k <= 50; k++) {
    const x = (k - 25) / 25; // −1 → +1
    lows.push(100 + 20 * x * x);
  }
  lows.push(114, 114.3, 114, 114.2);
  return lows.map((low, i) => ({
    timestamp: BASE_TS + i * TF,
    open: low + 0.4,
    high: low + 0.7,
    low,
    close: low + 0.3,
    volume: 1000,
  }));
}

/** NEGATIVE: still-falling parabola — vertex at the very end, no recovery. */
export function fallingParabolaCandles(): Candle[] {
  const lows: number[] = [];
  for (let k = 0; k < 60; k++) {
    const x = (k - 59) / 59; // −1 → 0: monotonically decreasing into the end
    lows.push(100 + 20 * x * x);
  }
  return lows.map((low, i) => ({
    timestamp: BASE_TS + i * TF,
    open: low + 0.4,
    high: low + 0.7,
    low,
    close: low + 0.3,
    volume: 1000,
  }));
}

/** Gap up: 20 quiet bars (~ATR 1), then a ~4-ATR breakaway gap that never fills. */
export function gapUpCandles(): Candle[] {
  const out: Candle[] = [];
  for (let i = 0; i < 20; i++) {
    const close = 100 + (i % 2 === 0 ? 0.3 : -0.3);
    out.push({ timestamp: BASE_TS + i * TF, open: 100, high: close + 0.5, low: 99.2, close, volume: 1000 });
  }
  // The gap candle: low well above the previous high, then a quiet drift that
  // stays above the gap (unfilled).
  for (let i = 20; i < 28; i++) {
    const base = 106 + (i - 20) * 0.2;
    out.push({ timestamp: BASE_TS + i * TF, open: base, high: base + 0.6, low: base - 0.4, close: base + 0.3, volume: 1500 });
  }
  return out;
}

/** NEGATIVE: same gap, later filled — price trades back through the zone. */
export function gapFilledCandles(): Candle[] {
  const out = gapUpCandles();
  const last = out[out.length - 1];
  out.push({
    timestamp: last.timestamp + TF,
    open: last.close,
    high: last.close,
    low: 100.2, // back through the pre-gap high → gap consumed
    close: 100.5,
    volume: 2000,
  });
  return out;
}

/** NEGATIVE: micro-gaps far below the ATR floor. */
export function microGapCandles(): Candle[] {
  const out: Candle[] = [];
  for (let i = 0; i < 30; i++) {
    const base = 100 + i * 0.1;
    // Each candle opens a hair above the previous high — sub-noise gaps.
    out.push({ timestamp: BASE_TS + i * TF, open: base, high: base + 1, low: base - 1, close: base + 0.5, volume: 1000 });
  }
  return out;
}

/**
 * Piecewise-linear path through explicit pivot prices: `barsPerLeg` candles
 * per leg, a short lead-in before the first pivot (so it confirms as a swing)
 * and a short tail after the last (so the final pivot confirms too).
 * The harmonic fixtures feed exact Fibonacci legs through this.
 */
export function pivotPathCandles(pivots: number[], barsPerLeg = 6, tail = 4): Candle[] {
  const closes: number[] = [];
  // Lead-in: approach the first pivot from the side the first leg departs to
  // (e.g. from BELOW a swing high whose leg goes down) so it confirms as a pivot.
  const firstLeg = pivots[1] - pivots[0];
  for (let k = 3; k >= 1; k--) closes.push(pivots[0] + (firstLeg * 0.25 * k) / 3);
  closes.push(pivots[0]);
  for (let p = 0; p < pivots.length - 1; p++) {
    for (let k = 1; k <= barsPerLeg; k++) {
      closes.push(pivots[p] + ((pivots[p + 1] - pivots[p]) * k) / barsPerLeg);
    }
  }
  // Tail: drift 10% of the last leg back the other way — confirms the final
  // pivot without creating a new structural swing.
  const lastLeg = pivots[pivots.length - 1] - pivots[pivots.length - 2];
  for (let k = 1; k <= tail; k++) closes.push(pivots[pivots.length - 1] - (lastLeg * 0.1 * k) / tail);

  const out: Candle[] = [];
  for (let i = 0; i < closes.length; i++) {
    const close = closes[i];
    const prev = i === 0 ? close : closes[i - 1];
    const open = (prev + close) / 2;
    out.push({
      timestamp: BASE_TS + i * TF,
      open,
      high: Math.max(open, close) + 0.15,
      low: Math.min(open, close) - 0.15,
      close,
      volume: 1000,
    });
  }
  return out;
}

/** Bullish ABCD: BC = 0.618·AB exactly, CD = 1.4·BC. D completes on a low. */
export const abcdBullishCandles = (): Candle[] =>
  // A=110, B=90 (AB 20), C=90+12.36=102.36, D=102.36−17.304=85.056
  pivotPathCandles([110, 90, 102.36, 85.056]);

/** Bullish Gartley: B = 0.618·XA, C = 0.55·AB, D = 0.786·XA. */
export const gartleyBullishCandles = (): Candle[] =>
  // X=80, A=120 (XA 40), B=120−24.72=95.28, C=95.28+13.596=108.876, D=120−31.44=88.56
  pivotPathCandles([80, 120, 95.28, 108.876, 88.56]);

/** Bullish Bat: B = 0.45·XA, C = 0.5·AB, D = 0.886·XA (deep retest). */
export const batBullishCandles = (): Candle[] =>
  // X=80, A=120, B=120−18=102, C=102+9=111, D=120−35.44=84.56
  pivotPathCandles([80, 120, 102, 111, 84.56]);

/** Triple top: three aligned peaks (spread 0.58%) over deep ~15-ATR valleys. */
export const tripleTopCandles = (): Candle[] =>
  pivotPathCandles([120, 104, 119.5, 105, 120.2]);

/** Triple bottom: mirror W-W structure. */
export const tripleBottomCandles = (): Candle[] =>
  pivotPathCandles([100, 116, 100.5, 115, 99.8]);

/** NEGATIVE: aligned tops but a SHALLOW dip between (the dip is sub-ATR after
 *  the big prior legs, so zigzag never even forms the M) — a pause, not a
 *  reversal structure. */
export const shallowDoubleTopCandles = (): Candle[] =>
  pivotPathCandles([100, 160, 156, 160.4]);

/** NEGATIVE: deep valley but tops misaligned by ~5% — a lower high, not a retest. */
export const misalignedDoubleTopCandles = (): Candle[] =>
  pivotPathCandles([120, 100, 114]);

/** NEGATIVE: ABCD shape but BC = 0.5·AB — between both valid ratios. */
export const brokenAbcdCandles = (): Candle[] =>
  pivotPathCandles([110, 90, 100, 86]);

/** NEGATIVE: XABCD with B = 0.70·XA — in the dead zone between Gartley (0.618)
 *  and Bat (0.382–0.50) B-windows. */
export const brokenXabcdCandles = (): Candle[] =>
  // X=80, A=120, B=120−28=92, C=92+15.4=107.4 (0.55·AB), D=120−31.44=88.56
  pivotPathCandles([80, 120, 92, 107.4, 88.56]);

/** Seeded LCG in [-1, 1] — deterministic noise for negative fixtures. */
function lcg(seed: number): () => number {
  let s = seed;
  return () => {
    s = (s * 1103515245 + 12345) & 0x7fffffff;
    return (s / 0x7fffffff) * 2 - 1;
  };
}

/**
 * NEGATIVE fixture: an uptrend with violent, containment-breaking noise.
 * Looks trendy, but closes spike far outside any fitted band — an honest
 * channel detector must emit ZERO hits here.
 */
export function noisyTrendCandles(n = 60, seed = 7): Candle[] {
  const rng = lcg(seed);
  const out: Candle[] = [];
  for (let i = 0; i < n; i++) {
    const spike = i % 11 === 0 ? rng() * 14 : 0; // periodic violent outliers
    const close = 100 + 0.5 * i + rng() * 4 + spike;
    const prev = i === 0 ? close : out[i - 1].close;
    out.push({
      timestamp: BASE_TS + i * TF,
      open: prev,
      high: Math.max(prev, close) + Math.abs(rng()) * 2,
      low: Math.min(prev, close) - Math.abs(rng()) * 2,
      close,
      volume: 1000,
    });
  }
  return out;
}

/** NEGATIVE fixture: pure random walk — no structure of any kind. */
export function randomWalkCandles(n = 80, seed = 1234): Candle[] {
  const rng = lcg(seed);
  const out: Candle[] = [];
  let price = 100;
  for (let i = 0; i < n; i++) {
    const prev = price;
    price = Math.max(5, price + rng() * 2.5);
    out.push({
      timestamp: BASE_TS + i * TF,
      open: prev,
      high: Math.max(prev, price) + Math.abs(rng()),
      low: Math.min(prev, price) - Math.abs(rng()),
      close: price,
      volume: 1000,
    });
  }
  return out;
}

/** Big impulse + small pullback = bull flag. */
export function bullFlagCandles(): Candle[] {
  const out: Candle[] = [];
  // 10 candles of consolidation
  for (let i = 0; i < 10; i++) {
    out.push({ timestamp: BASE_TS + i * TF, open: 100, high: 101, low: 99, close: 100, volume: 1000 });
  }
  // 10 candles of impulse up (~10% move)
  for (let i = 0; i < 10; i++) {
    const p = 100 + (i + 1) * 1.2;
    out.push({ timestamp: BASE_TS + (10 + i) * TF, open: p - 0.5, high: p + 0.5, low: p - 1, close: p, volume: 2000 });
  }
  // 10 candles of pullback (small, ~2%)
  for (let i = 0; i < 10; i++) {
    const p = 112 - i * 0.25;
    out.push({ timestamp: BASE_TS + (20 + i) * TF, open: p, high: p + 0.3, low: p - 0.3, close: p, volume: 800 });
  }
  return out;
}
