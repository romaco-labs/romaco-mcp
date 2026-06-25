import type { Candle, TrendSummary, PlrSegment, Direction } from './types.js';

/**
 * Linear regression on close prices vs index.
 * Returns slope, intercept, r-squared.
 */
function linreg(closes: number[]): { slope: number; intercept: number; r2: number } {
  const n = closes.length;
  if (n < 2) return { slope: 0, intercept: closes[0] ?? 0, r2: 0 };

  let sumX = 0, sumY = 0, sumXY = 0, sumX2 = 0, sumY2 = 0;
  for (let i = 0; i < n; i++) {
    sumX += i;
    sumY += closes[i];
    sumXY += i * closes[i];
    sumX2 += i * i;
    sumY2 += closes[i] * closes[i];
  }

  const denom = n * sumX2 - sumX * sumX;
  if (denom === 0) return { slope: 0, intercept: sumY / n, r2: 0 };

  const slope = (n * sumXY - sumX * sumY) / denom;
  const intercept = (sumY - slope * sumX) / n;

  // r^2 = 1 - SS_res / SS_tot
  const meanY = sumY / n;
  let ssRes = 0, ssTot = 0;
  for (let i = 0; i < n; i++) {
    const yHat = slope * i + intercept;
    ssRes += (closes[i] - yHat) ** 2;
    ssTot += (closes[i] - meanY) ** 2;
  }
  const r2 = ssTot === 0 ? 0 : Math.max(0, 1 - ssRes / ssTot);

  return { slope, intercept, r2 };
}

/**
 * Detect overall trend direction on the full candle window.
 * Direction: slope sign + magnitude vs noise.
 * Strength: r^2 of linear regression.
 */
export function detectTrend(candles: Candle[]): TrendSummary {
  if (candles.length < 2) {
    return { direction: 'sideways', strength: 0, duration_candles: candles.length, slope_pct_per_candle: 0 };
  }

  const closes = candles.map(c => c.close);
  const { slope, r2 } = linreg(closes);
  const avgPrice = closes.reduce((a, b) => a + b, 0) / closes.length;
  const slopePct = avgPrice === 0 ? 0 : (slope / avgPrice) * 100;

  // Direction: if slope is meaningful (>0.05% per candle) AND r^2 > 0.2
  let direction: Direction;
  if (r2 < 0.2 || Math.abs(slopePct) < 0.05) {
    direction = 'sideways';
  } else if (slope > 0) {
    direction = 'up';
  } else {
    direction = 'down';
  }

  return {
    direction,
    strength: r2,
    duration_candles: candles.length,
    slope_pct_per_candle: slopePct,
  };
}

/**
 * Piecewise Linear Representation.
 * Segments the candle series into impulse/correction/consolidation phases
 * using a bottom-up merge algorithm with a max-error threshold.
 *
 * @param candles input series
 * @param maxSegments target maximum segments (default 8 — keeps it LLM-friendly)
 */
export function piecewiseLinear(candles: Candle[], maxSegments = 8): PlrSegment[] {
  if (candles.length < 2) return [];

  // Start with one segment per pair
  type Seg = { start: number; end: number };
  const segs: Seg[] = [];
  for (let i = 0; i < candles.length - 1; i++) {
    segs.push({ start: i, end: i + 1 });
  }

  // Bottom-up merge: find adjacent pair with smallest combined error, merge.
  // Repeat until we hit maxSegments.
  function segError(s: Seg): number {
    const slice = candles.slice(s.start, s.end + 1).map(c => c.close);
    const { slope, intercept } = linreg(slice);
    let err = 0;
    for (let i = 0; i < slice.length; i++) {
      err += (slice[i] - (slope * i + intercept)) ** 2;
    }
    return err;
  }

  while (segs.length > maxSegments) {
    let bestIdx = 0;
    let bestErr = Infinity;
    for (let i = 0; i < segs.length - 1; i++) {
      const merged: Seg = { start: segs[i].start, end: segs[i + 1].end };
      const err = segError(merged);
      if (err < bestErr) {
        bestErr = err;
        bestIdx = i;
      }
    }
    segs.splice(bestIdx, 2, { start: segs[bestIdx].start, end: segs[bestIdx + 1].end });
  }

  // Classify each segment
  const avgPrice = candles.reduce((a, c) => a + c.close, 0) / candles.length;

  return segs.map(s => {
    const fromCandle = candles[s.start];
    const toCandle = candles[s.end];
    const magPct = fromCandle.close === 0 ? 0 : ((toCandle.close - fromCandle.close) / fromCandle.close) * 100;
    const absMag = Math.abs(magPct);
    const slope = (toCandle.close - fromCandle.close) / (s.end - s.start);
    const slopePctPerCandle = avgPrice === 0 ? 0 : (slope / avgPrice) * 100;

    let kind: PlrSegment['kind'];
    if (absMag < 0.5 || Math.abs(slopePctPerCandle) < 0.05) {
      kind = 'consolidation';
    } else if (absMag >= 2) {
      kind = 'impulse';
    } else {
      kind = 'correction';
    }

    return {
      from_ts: fromCandle.timestamp,
      to_ts: toCandle.timestamp,
      from_price: fromCandle.close,
      to_price: toCandle.close,
      kind,
      magnitude_pct: magPct,
      candle_count: s.end - s.start + 1,
    };
  });
}
