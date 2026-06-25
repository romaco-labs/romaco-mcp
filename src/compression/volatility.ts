import type { Candle, VolatilitySummary } from './types.js';

/**
 * True Range for a single candle (vs previous close).
 */
function trueRange(cur: Candle, prevClose: number): number {
  return Math.max(
    cur.high - cur.low,
    Math.abs(cur.high - prevClose),
    Math.abs(cur.low - prevClose),
  );
}

/**
 * Average True Range — Wilder's smoothing.
 */
export function atr(candles: Candle[], period = 14): number[] {
  const out = new Array<number>(candles.length).fill(NaN);
  if (candles.length <= period) return out;

  let tr = 0;
  for (let i = 1; i <= period; i++) {
    tr += trueRange(candles[i], candles[i - 1].close);
  }
  out[period] = tr / period;

  for (let i = period + 1; i < candles.length; i++) {
    const t = trueRange(candles[i], candles[i - 1].close);
    out[i] = (out[i - 1] * (period - 1) + t) / period;
  }

  return out;
}

/**
 * Simple Moving Average.
 */
function sma(values: number[], period: number): number[] {
  const out = new Array<number>(values.length).fill(NaN);
  if (values.length < period) return out;

  let sum = 0;
  for (let i = 0; i < period; i++) sum += values[i];
  out[period - 1] = sum / period;

  for (let i = period; i < values.length; i++) {
    sum += values[i] - values[i - period];
    out[i] = sum / period;
  }

  return out;
}

/**
 * Standard deviation over a rolling window.
 */
function rollingStd(values: number[], period: number): number[] {
  const out = new Array<number>(values.length).fill(NaN);
  const means = sma(values, period);
  for (let i = period - 1; i < values.length; i++) {
    let s = 0;
    for (let j = i - period + 1; j <= i; j++) {
      s += (values[j] - means[i]) ** 2;
    }
    out[i] = Math.sqrt(s / period);
  }
  return out;
}

/**
 * Bollinger Bands (period=20, stddev=2 by default).
 */
export function bollingerBands(
  candles: Candle[],
  period = 20,
  multiplier = 2,
): { upper: number[]; middle: number[]; lower: number[] } {
  const closes = candles.map(c => c.close);
  const middle = sma(closes, period);
  const std = rollingStd(closes, period);
  const upper = middle.map((m, i) => m + multiplier * std[i]);
  const lower = middle.map((m, i) => m - multiplier * std[i]);
  return { upper, middle, lower };
}

/**
 * Keltner Channels (EMA-based mid, ATR for band width).
 */
function keltnerChannels(
  candles: Candle[],
  period = 20,
  atrMultiplier = 1.5,
): { upper: number[]; lower: number[] } {
  const closes = candles.map(c => c.close);
  const mid = sma(closes, period); // SMA for simplicity; many implementations use EMA
  const atrSeries = atr(candles, period);
  const upper = mid.map((m, i) => m + atrMultiplier * atrSeries[i]);
  const lower = mid.map((m, i) => m - atrMultiplier * atrSeries[i]);
  return { upper, lower };
}

/**
 * Detect Bollinger Bands squeeze:
 * BB width contracts inside Keltner channel width = low volatility, imminent expansion.
 */
export function detectBollingerSqueeze(candles: Candle[], period = 20): boolean {
  const bb = bollingerBands(candles, period);
  const kc = keltnerChannels(candles, period);
  const i = candles.length - 1;
  if (i < period || Number.isNaN(bb.upper[i]) || Number.isNaN(kc.upper[i])) return false;
  return bb.upper[i] < kc.upper[i] && bb.lower[i] > kc.lower[i];
}

/**
 * Full volatility summary.
 */
export function volatilitySummary(candles: Candle[]): VolatilitySummary {
  const atrSeries = atr(candles);
  const lastAtr = atrSeries[atrSeries.length - 1] ?? 0;
  const lastPrice = candles[candles.length - 1]?.close ?? 0;
  const atrPct = lastPrice === 0 ? 0 : (lastAtr / lastPrice) * 100;

  const bb = bollingerBands(candles);
  const i = candles.length - 1;
  const bbWidth = Number.isFinite(bb.upper[i]) ? bb.upper[i] - bb.lower[i] : 0;
  const bbWidthPct = lastPrice === 0 ? 0 : (bbWidth / lastPrice) * 100;

  const squeeze = detectBollingerSqueeze(candles);

  // Compare current BB width to mean of last 20 widths to determine state
  const widths: number[] = [];
  for (let k = Math.max(0, i - 20); k <= i; k++) {
    if (Number.isFinite(bb.upper[k]) && Number.isFinite(bb.lower[k])) {
      widths.push(bb.upper[k] - bb.lower[k]);
    }
  }
  let state: VolatilitySummary['state'] = 'stable';
  if (widths.length >= 2) {
    const meanW = widths.reduce((a, b) => a + b, 0) / widths.length;
    if (bbWidth > meanW * 1.15) state = 'expanding';
    else if (bbWidth < meanW * 0.85) state = 'contracting';
  }

  return {
    atr: Number.isFinite(lastAtr) ? lastAtr : 0,
    atr_pct: atrPct,
    bb_squeeze: squeeze,
    bb_width_pct: bbWidthPct,
    state,
  };
}
