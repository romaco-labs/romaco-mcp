/**
 * Shared least-squares fitting over arbitrary x coordinates.
 *
 * Unlike trend.ts' internal linreg (x = 0..n-1 over closes), these accept any
 * (x, y) pairs — pattern detectors fit lines/parabolas through swing pivots
 * whose x values are candle indexes with gaps.
 */

export interface LineFit {
  slope: number;
  intercept: number;
  r2: number;
}

/** Ordinary least-squares line through (xs[i], ys[i]). */
export function linregXY(xs: number[], ys: number[]): LineFit {
  const n = Math.min(xs.length, ys.length);
  if (n === 0) return { slope: 0, intercept: 0, r2: 0 };
  let sx = 0, sy = 0, sxy = 0, sx2 = 0;
  for (let i = 0; i < n; i++) {
    sx += xs[i];
    sy += ys[i];
    sxy += xs[i] * ys[i];
    sx2 += xs[i] * xs[i];
  }
  const denom = n * sx2 - sx * sx;
  if (denom === 0) return { slope: 0, intercept: sy / n, r2: 0 };
  const slope = (n * sxy - sx * sy) / denom;
  const intercept = (sy - slope * sx) / n;

  const meanY = sy / n;
  let ssRes = 0, ssTot = 0;
  for (let i = 0; i < n; i++) {
    const pred = slope * xs[i] + intercept;
    ssRes += (ys[i] - pred) ** 2;
    ssTot += (ys[i] - meanY) ** 2;
  }
  // All-equal ys: the (horizontal) fit is exact — report perfect fit.
  const r2 = ssTot === 0 ? 1 : 1 - ssRes / ssTot;
  return { slope, intercept, r2 };
}

export interface QuadFit {
  a: number;
  b: number;
  c: number;
  r2: number;
  /** x of the parabola's vertex (-b / 2a); NaN when a === 0. */
  vertexX: number;
}

/**
 * Least-squares parabola y = a·x² + b·x + c via the 3×3 normal equations,
 * solved with Cramer's rule. Used by the cup & handle roundness gate.
 */
export function quadFitXY(xs: number[], ys: number[]): QuadFit {
  const n = Math.min(xs.length, ys.length);
  if (n < 3) return { a: 0, b: 0, c: n ? ys[0] : 0, r2: 0, vertexX: NaN };

  let s1 = 0, s2 = 0, s3 = 0, s4 = 0;
  let sy = 0, sxy = 0, sx2y = 0;
  for (let i = 0; i < n; i++) {
    const x = xs[i];
    const x2 = x * x;
    s1 += x;
    s2 += x2;
    s3 += x2 * x;
    s4 += x2 * x2;
    sy += ys[i];
    sxy += x * ys[i];
    sx2y += x2 * ys[i];
  }

  // | s4 s3 s2 | |a|   |sx2y|
  // | s3 s2 s1 | |b| = |sxy |
  // | s2 s1 n  | |c|   |sy  |
  const det3 = (
    m00: number, m01: number, m02: number,
    m10: number, m11: number, m12: number,
    m20: number, m21: number, m22: number,
  ): number => m00 * (m11 * m22 - m12 * m21) - m01 * (m10 * m22 - m12 * m20) + m02 * (m10 * m21 - m11 * m20);

  const D = det3(s4, s3, s2, s3, s2, s1, s2, s1, n);
  if (D === 0) return { a: 0, b: 0, c: sy / n, r2: 0, vertexX: NaN };

  const a = det3(sx2y, s3, s2, sxy, s2, s1, sy, s1, n) / D;
  const b = det3(s4, sx2y, s2, s3, sxy, s1, s2, sy, n) / D;
  const c = det3(s4, s3, sx2y, s3, s2, sxy, s2, s1, sy) / D;

  const meanY = sy / n;
  let ssRes = 0, ssTot = 0;
  for (let i = 0; i < n; i++) {
    const pred = a * xs[i] * xs[i] + b * xs[i] + c;
    ssRes += (ys[i] - pred) ** 2;
    ssTot += (ys[i] - meanY) ** 2;
  }
  const r2 = ssTot === 0 ? 1 : 1 - ssRes / ssTot;
  return { a, b, c, r2, vertexX: a === 0 ? NaN : -b / (2 * a) };
}

/**
 * quadFitXY over candle LOWS in the index range [from, to] (x = candle
 * index), without materializing xs/ys arrays.
 *
 * Exists because the cup pair scan evaluates thousands of candidate spans on
 * long series and profiling showed the array allocation dominating the fit
 * arithmetic itself. Accumulation order matches quadFitXY exactly — same adds
 * on the same values in the same sequence — so the result is BIT-IDENTICAL to
 * building the arrays and calling quadFitXY.
 */
export function quadFitLowsRange(
  candles: ArrayLike<{ low: number }>,
  from: number,
  to: number,
): QuadFit {
  const n = to - from + 1;
  if (n < 3) return { a: 0, b: 0, c: n > 0 ? candles[from].low : 0, r2: 0, vertexX: NaN };

  let s1 = 0, s2 = 0, s3 = 0, s4 = 0;
  let sy = 0, sxy = 0, sx2y = 0;
  for (let i = from; i <= to; i++) {
    const x = i;
    const x2 = x * x;
    const y = candles[i].low;
    s1 += x;
    s2 += x2;
    s3 += x2 * x;
    s4 += x2 * x2;
    sy += y;
    sxy += x * y;
    sx2y += x2 * y;
  }

  const det3 = (
    m00: number, m01: number, m02: number,
    m10: number, m11: number, m12: number,
    m20: number, m21: number, m22: number,
  ): number => m00 * (m11 * m22 - m12 * m21) - m01 * (m10 * m22 - m12 * m20) + m02 * (m10 * m21 - m11 * m20);

  const D = det3(s4, s3, s2, s3, s2, s1, s2, s1, n);
  if (D === 0) return { a: 0, b: 0, c: sy / n, r2: 0, vertexX: NaN };

  const a = det3(sx2y, s3, s2, sxy, s2, s1, sy, s1, n) / D;
  const b = det3(s4, sx2y, s2, s3, sxy, s1, s2, sy, n) / D;
  const c = det3(s4, s3, sx2y, s3, s2, sxy, s2, s1, sy) / D;

  const meanY = sy / n;
  let ssRes = 0, ssTot = 0;
  for (let i = from; i <= to; i++) {
    const pred = a * i * i + b * i + c;
    ssRes += (candles[i].low - pred) ** 2;
    ssTot += (candles[i].low - meanY) ** 2;
  }
  const r2 = ssTot === 0 ? 1 : 1 - ssRes / ssTot;
  return { a, b, c, r2, vertexX: a === 0 ? NaN : -b / (2 * a) };
}
