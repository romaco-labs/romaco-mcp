import { describe, expect, it } from 'vitest';
import { detectCupHandle } from '../../src/compression/cup.js';
import { quadFitXY } from '../../src/compression/fit.js';
import { buildScanContext } from '../../src/compression/scanContext.js';
import type { Candle, PatternHit, Swing } from '../../src/compression/types.js';
import {
  cupHandleCandles,
  cupNoHandleCandles,
  randomWalkCandles,
  vBottomCandles,
} from './fixtures.js';
import { realCandles } from './real_fixtures.js';

/**
 * Differential oracle for the cup pair-scan prune.
 *
 * The F0 bench exposed detectCupHandle as 97% of the worst-case scan cost
 * (36 ms of 37 ms at N=5000): a quadratic pair scan over zigzag highs with an
 * O(span) bottom rescan per pair. The fix is two EXACT transformations — a
 * dominance prune (right rims whose widest possible cup still fails the
 * handle ≤ span/2 gate can never hit) and an incremental running min — so the
 * v1 implementation below, copied verbatim, must agree on every series.
 */

const CUP_MIN_CANDLES = 40;
const CUP_MIN_SPAN = 20;
const CUP_RIM_TOL_PCT = 0.03;
const CUP_MIN_DEPTH_ATR = 2.5;
const CUP_MAX_DEPTH_FRAC = 0.35;
const CUP_MIN_R2 = 0.8;
const CUP_VERTEX_THIRD = 1 / 3;
const CUP_BASIN_DEPTH_FRAC = 0.2;
const CUP_MIN_BASIN_FRAC = 0.25;
const CUP_HANDLE_MIN_LEN = 3;
const CUP_HANDLE_MAX_DEPTH_FRAC = 0.5;
const CUP_HANDLE_RECOVERY_FRAC = 0.15;
const CUP_ARC_SAMPLES = 7;

/** v1 detectCupHandle, verbatim (pre-prune oracle). */
function detectCupHandleV1(candles: Candle[], zz: Swing[], atr: number): PatternHit[] {
  const n = candles.length;
  if (atr <= 0 || n < CUP_MIN_CANDLES) return [];
  const highs = zz.filter((s) => s.kind === 'high');
  if (highs.length < 2) return [];
  for (let r = highs.length - 1; r >= 1; r--) {
    const right = highs[r];
    const handleLen = n - 1 - right.index;
    if (handleLen < CUP_HANDLE_MIN_LEN) continue;
    for (let l = r - 1; l >= 0; l--) {
      const left = highs[l];
      if (right.index - left.index < CUP_MIN_SPAN) continue;
      const hit = evaluateCupV1(candles, left, right, atr);
      if (hit) return [hit];
    }
  }
  return [];
}

function evaluateCupV1(candles: Candle[], left: Swing, right: Swing, atr: number): PatternHit | null {
  const n = candles.length;
  const cupSpan = right.index - left.index;
  const handleLen = n - 1 - right.index;
  if (handleLen < CUP_HANDLE_MIN_LEN || handleLen > cupSpan / 2) return null;

  const rimHigh = Math.max(left.price, right.price);
  if (Math.abs(left.price - right.price) > CUP_RIM_TOL_PCT * rimHigh) return null;
  const rim = (left.price + right.price) / 2;

  let bottom = Infinity;
  for (let i = left.index; i <= right.index; i++) bottom = Math.min(bottom, candles[i].low);
  const depth = rim - bottom;
  if (depth < CUP_MIN_DEPTH_ATR * atr || depth > CUP_MAX_DEPTH_FRAC * rim) return null;

  const xs: number[] = [];
  const ys: number[] = [];
  for (let i = left.index; i <= right.index; i++) {
    xs.push(i);
    ys.push(candles[i].low);
  }
  const q = quadFitXY(xs, ys);
  if (q.a <= 0 || q.r2 < CUP_MIN_R2) return null;
  if (q.vertexX < left.index + cupSpan * CUP_VERTEX_THIRD || q.vertexX > right.index - cupSpan * CUP_VERTEX_THIRD) {
    return null;
  }

  const basinCeiling = bottom + CUP_BASIN_DEPTH_FRAC * depth;
  let basinCount = 0;
  for (let i = left.index; i <= right.index; i++) {
    if (candles[i].low <= basinCeiling) basinCount++;
  }
  if (basinCount / (cupSpan + 1) < CUP_MIN_BASIN_FRAC) return null;

  let handleLowIdx = right.index + 1;
  for (let i = right.index + 1; i < n; i++) {
    if (candles[i].low < candles[handleLowIdx].low) handleLowIdx = i;
  }
  const handleLow = candles[handleLowIdx].low;
  const handleDepth = rim - handleLow;
  if (handleDepth <= 0) return null;
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
  for (let k = 0; k < CUP_ARC_SAMPLES; k++) {
    const x = left.index + (cupSpan * k) / (CUP_ARC_SAMPLES - 1);
    const i = Math.round(x);
    points.push({ ts: candles[i].timestamp, price: q.a * x * x + q.b * x + q.c, role: 'arc' });
  }

  return {
    kind: 'cup_handle',
    confidence,
    points,
    target_price: rim + depth,
    invalidation_price: handleLow,
  };
}

function compare(candles: Candle[]): void {
  const ctx = buildScanContext(candles);
  expect(detectCupHandle(candles, ctx.zigzag, ctx.lastAtr)).toEqual(
    detectCupHandleV1(candles, ctx.zigzag, ctx.lastAtr),
  );
}

describe('cup pair-scan prune ≡ v1', () => {
  it('positive fixture still fires identically', () => {
    const candles = cupHandleCandles();
    const ctx = buildScanContext(candles);
    const hits = detectCupHandle(candles, ctx.zigzag, ctx.lastAtr);
    expect(hits).toHaveLength(1);
    compare(candles);
  });

  it('negative fixtures stay negative identically', () => {
    compare(vBottomCandles());
    compare(cupNoHandleCandles());
  });

  it('agrees on 40 seeded random walks (the hot path)', () => {
    for (let s = 0; s < 40; s++) {
      compare(randomWalkCandles(160, 5000 + s));
    }
  });

  it('agrees on every recorded real fixture', () => {
    for (const sym of ['TSLA', 'XOM', 'AAPL', 'MSTR', 'SPY', 'META', 'KO', 'JPM']) {
      compare(realCandles(sym));
    }
  });
});
