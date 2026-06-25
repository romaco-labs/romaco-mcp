import type { Candle, PatternHit, Swing } from './types.js';
import { quadFitLowsRange } from './fit.js';

/**
 * Cup & handle (bullish accumulation): a rounded basin between two rims at a
 * similar level, followed by a shallow handle pullback that recovers toward
 * the rim. Bullish only — no inverted cup in v1.
 *
 * Honest-signal contract: roundness is the core gate (a parabola must
 * genuinely FIT the lows), a V-spike is rejected by the basin-width gate even
 * when it fits a parabola numerically, and a cup WITHOUT a completed handle
 * emits nothing — an unfinished pattern is "no pattern", never a guess.
 */

/** Minimum candles in the series. */
const CUP_MIN_CANDLES = 40;
/** Minimum candles between the two rims. */
const CUP_MIN_SPAN = 20;
/** The rims must match within this fraction of the higher rim. */
const CUP_RIM_TOL_PCT = 0.03;
/** Cup depth must clear noise… */
const CUP_MIN_DEPTH_ATR = 2.5;
/** …but a crater deeper than this fraction of the rim is a crash, not a cup. */
const CUP_MAX_DEPTH_FRAC = 0.35;
/** Parabola fit quality on the cup lows. */
const CUP_MIN_R2 = 0.8;
/** The parabola's vertex must sit in the middle third of the cup. */
const CUP_VERTEX_THIRD = 1 / 3;
/** Basin: lows within this fraction of depth above the bottom… */
const CUP_BASIN_DEPTH_FRAC = 0.2;
/** …must cover at least this fraction of the cup span. A true bowl's basin is
 *  wide (~45% for a parabola); a V-spike's is ~20% even when its r² looks fine. */
const CUP_MIN_BASIN_FRAC = 0.25;
/** Handle: 3..cupSpan/2 candles after the right rim. */
const CUP_HANDLE_MIN_LEN = 3;
/** Handle may retrace at most this fraction of the cup depth. */
const CUP_HANDLE_MAX_DEPTH_FRAC = 0.5;
/** The last close must have recovered to within this fraction of depth below the rim. */
const CUP_HANDLE_RECOVERY_FRAC = 0.15;
/** Number of parabola samples emitted as 'arc' points for drawing. */
const CUP_ARC_SAMPLES = 7;

// ── Rounding bottom (cup without the handle requirement) ───────────────────
/** Suffix windows scanned for a rounded basin. */
const RB_WINDOWS = [40, 60, 90];
/** The recovery must have climbed back at least this fraction of the depth
 *  above the bottom — a bowl whose right side never rose is just a decline. */
const RB_MIN_RECOVERY_FRAC = 0.6;
/** Liveness: a close further than this fraction of depth ABOVE the rim means
 *  the breakout already ran — stale signal. */
const RB_MAX_OVERSHOOT_FRAC = 0.15;
/** The vertex must sit inside this central band of the window so both the
 *  decline and the recovery are inside the data. */
const RB_VERTEX_MIN_FRAC = 0.25;
const RB_VERTEX_MAX_FRAC = 0.8;

export function detectCupHandle(candles: Candle[], zz: Swing[], atr: number): PatternHit[] {
  const n = candles.length;
  if (atr <= 0 || n < CUP_MIN_CANDLES) return [];

  const highs = zz.filter((s) => s.kind === 'high');
  if (highs.length < 2) return [];
  const firstHighIndex = highs[0].index;

  // Prefer the most recent completable structure: scan right rims from the
  // newest backwards, left rims from the closest pair outward.
  for (let r = highs.length - 1; r >= 1; r--) {
    const right = highs[r];
    const handleLen = n - 1 - right.index;
    if (handleLen < CUP_HANDLE_MIN_LEN) continue; // no room for a handle yet
    // Handle ≤ half the cup: when even the widest possible cup for this right
    // rim (left rim = the oldest high) cannot satisfy that, every pair in the
    // row fails the same gate inside evaluateCup — skip the row. (This is the
    // dominance prune that keeps the pair scan from going quadratic on long
    // series: only right rims in the final third of the data can complete.)
    if (right.index - firstHighIndex < 2 * handleLen) continue;

    // The cup bottom is a running min over [left.index, right.index]: extend
    // it incrementally as the left rim walks outward instead of rescanning
    // the whole span for every candidate pair.
    let bottom = Infinity;
    let scannedFrom = right.index + 1; // candles below this index not yet scanned
    for (let l = r - 1; l >= 0; l--) {
      const left = highs[l];
      for (let i = scannedFrom - 1; i >= left.index; i--) {
        if (candles[i].low < bottom) bottom = candles[i].low;
      }
      scannedFrom = left.index;
      if (right.index - left.index < CUP_MIN_SPAN) continue;
      const hit = evaluateCup(candles, left, right, atr, bottom);
      if (hit) return [hit];
    }
  }
  return [];
}

function evaluateCup(
  candles: Candle[],
  left: Swing,
  right: Swing,
  atr: number,
  bottom: number,
): PatternHit | null {
  const n = candles.length;
  const cupSpan = right.index - left.index;
  const handleLen = n - 1 - right.index;
  if (handleLen < CUP_HANDLE_MIN_LEN || handleLen > cupSpan / 2) return null;

  const rimHigh = Math.max(left.price, right.price);
  if (Math.abs(left.price - right.price) > CUP_RIM_TOL_PCT * rimHigh) return null;
  const rim = (left.price + right.price) / 2;

  // Depth from the lowest low inside the cup (running min from the caller).
  const depth = rim - bottom;
  if (depth < CUP_MIN_DEPTH_ATR * atr || depth > CUP_MAX_DEPTH_FRAC * rim) return null;

  // Roundness: a parabola must fit the cup lows, opening upward, bottoming
  // in the middle third. (Range fit — bit-identical to quadFitXY on the
  // materialized arrays; the pair scan calls this far too often to allocate.)
  const q = quadFitLowsRange(candles, left.index, right.index);
  if (q.a <= 0 || q.r2 < CUP_MIN_R2) return null;
  if (q.vertexX < left.index + cupSpan * CUP_VERTEX_THIRD || q.vertexX > right.index - cupSpan * CUP_VERTEX_THIRD) {
    return null;
  }

  // Anti-V: a rounded bowl spends real time near its bottom.
  const basinCeiling = bottom + CUP_BASIN_DEPTH_FRAC * depth;
  let basinCount = 0;
  for (let i = left.index; i <= right.index; i++) {
    if (candles[i].low <= basinCeiling) basinCount++;
  }
  if (basinCount / (cupSpan + 1) < CUP_MIN_BASIN_FRAC) return null;

  // Handle: shallow pullback after the right rim that has already recovered.
  let handleLowIdx = right.index + 1;
  for (let i = right.index + 1; i < n; i++) {
    if (candles[i].low < candles[handleLowIdx].low) handleLowIdx = i;
  }
  const handleLow = candles[handleLowIdx].low;
  const handleDepth = rim - handleLow;
  if (handleDepth <= 0) return null; // no pullback at all = no handle structure
  if (handleDepth > CUP_HANDLE_MAX_DEPTH_FRAC * depth) return null;
  const lastClose = candles[n - 1].close;
  if (lastClose < rim - CUP_HANDLE_RECOVERY_FRAC * depth) return null;

  const handleDepthRatio = handleDepth / depth;
  const rimDiff = Math.abs(left.price - right.price) / rimHigh;
  const confidence = Math.min(
    0.85,
    0.5 +
      0.2 * ((q.r2 - CUP_MIN_R2) / (1 - CUP_MIN_R2)) +
      0.1 * (1 - rimDiff / CUP_RIM_TOL_PCT) +
      0.05 * (1 - handleDepthRatio / CUP_HANDLE_MAX_DEPTH_FRAC),
  );

  const points: PatternHit['points'] = [
    { ts: left.ts, price: left.price, role: 'left_rim' },
    { ts: candles[Math.round(Math.min(Math.max(q.vertexX, left.index), right.index))].timestamp, price: bottom, role: 'cup_bottom' },
    { ts: right.ts, price: right.price, role: 'right_rim' },
    { ts: candles[handleLowIdx].timestamp, price: handleLow, role: 'handle_low' },
    { ts: candles[n - 1].timestamp, price: lastClose, role: 'handle_end' },
  ];
  // Arc samples from OUR fit (the mapper has no candles and must not re-derive).
  for (let k = 0; k < CUP_ARC_SAMPLES; k++) {
    const x = left.index + (cupSpan * k) / (CUP_ARC_SAMPLES - 1);
    const i = Math.round(x);
    points.push({ ts: candles[i].timestamp, price: q.a * x * x + q.b * x + q.c, role: 'arc' });
  }

  return {
    kind: 'cup_handle',
    confidence,
    points,
    target_price: rim + depth, // measured move: cup depth above the rim
    invalidation_price: handleLow,
  };
}

/**
 * Rounding bottom: the cup's parabolic basin WITHOUT the handle requirement —
 * a long, gradual accumulation bowl whose right side has already recovered.
 *
 * Shares the cup's honesty gates (quadratic fit r² ≥ 0.8, anti-V basin width,
 * depth vs ATR) and adds recovery/liveness: the right side must have climbed
 * back ≥ 60% of the depth, and a close that already ran past the rim is a
 * stale signal, not a setup. detectPatterns suppresses this detector whenever
 * cup & handle fired — one structure, one signal.
 */
export function detectRoundingBottom(candles: Candle[], zz: Swing[], atr: number): PatternHit[] {
  void zz;
  const n = candles.length;
  if (atr <= 0 || n < CUP_MIN_CANDLES) return [];

  for (const w of RB_WINDOWS) {
    if (w > n) break;
    const start = n - w;
    const q = quadFitLowsRange(candles, start, n - 1);
    if (q.a <= 0 || q.r2 < CUP_MIN_R2) continue;
    if (q.vertexX < start + w * RB_VERTEX_MIN_FRAC || q.vertexX > start + w * RB_VERTEX_MAX_FRAC) continue;

    const fit = (x: number): number => q.a * x * x + q.b * x + q.c;
    const bottom = fit(q.vertexX);
    // Rim = the lower of the two bowl edges (conservative breakout level).
    const rim = Math.min(fit(start), fit(n - 1));
    const depth = rim - bottom;
    if (depth < CUP_MIN_DEPTH_ATR * atr || depth > CUP_MAX_DEPTH_FRAC * rim) continue;

    // Anti-V: a rounded bowl spends real time near its bottom.
    const basinCeiling = bottom + CUP_BASIN_DEPTH_FRAC * depth;
    let basinCount = 0;
    for (let i = start; i < n; i++) {
      if (candles[i].low <= basinCeiling) basinCount++;
    }
    if (basinCount / w < CUP_MIN_BASIN_FRAC) continue;

    // Recovery underway, but not already run away (liveness).
    const lastClose = candles[n - 1].close;
    if (lastClose < bottom + RB_MIN_RECOVERY_FRAC * depth) continue;
    if (lastClose > rim + RB_MAX_OVERSHOOT_FRAC * depth) continue;

    const vertexIdx = Math.round(Math.min(Math.max(q.vertexX, start), n - 1));
    const points: PatternHit['points'] = [
      { ts: candles[start].timestamp, price: fit(start), role: 'rim_left' },
      { ts: candles[vertexIdx].timestamp, price: bottom, role: 'bottom' },
      { ts: candles[n - 1].timestamp, price: lastClose, role: 'recovery_end' },
    ];
    for (let k = 0; k < CUP_ARC_SAMPLES; k++) {
      const x = start + ((w - 1) * k) / (CUP_ARC_SAMPLES - 1);
      points.push({ ts: candles[Math.round(x)].timestamp, price: fit(x), role: 'arc' });
    }

    const confidence = Math.min(
      0.85,
      0.5 +
        0.2 * ((q.r2 - CUP_MIN_R2) / (1 - CUP_MIN_R2)) +
        0.1 * Math.min(1, basinCount / w / (2 * CUP_MIN_BASIN_FRAC)),
    );

    return [{
      kind: 'rounding_bottom',
      confidence,
      points,
      target_price: rim + depth, // measured move above the rim
      invalidation_price: bottom,
    }];
  }
  return [];
}
