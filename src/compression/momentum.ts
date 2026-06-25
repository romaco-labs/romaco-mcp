import type { Candle, MomentumSummary, Divergence } from './types.js';
import { findPivotsInSeries } from './pivots.js';

/**
 * RSI (Relative Strength Index) using Wilder's smoothing.
 * Returns array of same length as candles; first `period` entries are NaN.
 */
export function rsi(candles: Candle[], period = 14): number[] {
  const out = new Array<number>(candles.length).fill(NaN);
  if (candles.length <= period) return out;

  let gainSum = 0;
  let lossSum = 0;
  for (let i = 1; i <= period; i++) {
    const change = candles[i].close - candles[i - 1].close;
    if (change > 0) gainSum += change;
    else lossSum -= change;
  }
  let avgGain = gainSum / period;
  let avgLoss = lossSum / period;
  out[period] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);

  for (let i = period + 1; i < candles.length; i++) {
    const change = candles[i].close - candles[i - 1].close;
    const gain = change > 0 ? change : 0;
    const loss = change < 0 ? -change : 0;
    avgGain = (avgGain * (period - 1) + gain) / period;
    avgLoss = (avgLoss * (period - 1) + loss) / period;
    out[i] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);
  }

  return out;
}

/**
 * EMA with adjustable period.
 */
export function ema(values: number[], period: number): number[] {
  const out = new Array<number>(values.length).fill(NaN);
  if (values.length === 0) return out;
  const k = 2 / (period + 1);
  out[0] = values[0];
  for (let i = 1; i < values.length; i++) {
    out[i] = values[i] * k + out[i - 1] * (1 - k);
  }
  return out;
}

/**
 * MACD: (EMA12 - EMA26), signal = EMA9 of MACD line, histogram = MACD - signal.
 */
export function macd(
  candles: Candle[],
  fast = 12,
  slow = 26,
  signalPeriod = 9,
): { macd: number[]; signal: number[]; histogram: number[] } {
  const closes = candles.map(c => c.close);
  const fastEma = ema(closes, fast);
  const slowEma = ema(closes, slow);
  const macdLine = fastEma.map((v, i) => v - slowEma[i]);
  const signal = ema(macdLine, signalPeriod);
  const histogram = macdLine.map((v, i) => v - signal[i]);
  return { macd: macdLine, signal, histogram };
}

/**
 * Detect MACD signal-line cross in the last `windowBars` bars.
 */
export function detectMacdCross(
  candles: Candle[],
  windowBars = 3,
): 'bullish' | 'bearish' | 'none' {
  const { macd: m, signal: s } = macd(candles);
  const n = candles.length;
  if (n < 2) return 'none';

  for (let i = Math.max(1, n - windowBars); i < n; i++) {
    const prev = m[i - 1] - s[i - 1];
    const cur = m[i] - s[i];
    if (prev <= 0 && cur > 0) return 'bullish';
    if (prev >= 0 && cur < 0) return 'bearish';
  }
  return 'none';
}

/**
 * Find pivots (local extremes) in a numeric series.
 * Used for divergence detection. Delegates to the shared pivot engine.
 */
const findPivots = findPivotsInSeries;

/**
 * Detect RSI / MACD divergence against price.
 *
 * Bullish divergence: price makes lower low, indicator makes higher low.
 * Bearish divergence: price makes higher high, indicator makes lower high.
 * Hidden bullish: price higher low, indicator lower low (continuation in uptrend).
 * Hidden bearish: price lower high, indicator higher high (continuation in downtrend).
 */
export function detectDivergences(
  candles: Candle[],
  indicator: 'rsi' | 'macd',
  lookback = 3,
): Divergence[] {
  const values = indicator === 'rsi' ? rsi(candles) : macd(candles).macd;
  const prices = candles.map(c => c.close);
  const pricePivots = findPivots(prices, lookback);
  const indPivots = findPivots(values, lookback);

  const found: Divergence[] = [];

  // Match nearest indicator pivot to each price pivot (within lookback*2 bars)
  function nearest(idx: number, kind: 'high' | 'low'): { index: number; value: number } | null {
    let best: { index: number; value: number } | null = null;
    let bestDist = lookback * 2 + 1;
    for (const p of indPivots) {
      if (p.kind !== kind) continue;
      const d = Math.abs(p.index - idx);
      if (d < bestDist) {
        bestDist = d;
        best = { index: p.index, value: p.value };
      }
    }
    return best;
  }

  // Iterate consecutive same-kind pivot pairs in price
  const lows = pricePivots.filter(p => p.kind === 'low');
  const highs = pricePivots.filter(p => p.kind === 'high');

  for (let i = 1; i < lows.length; i++) {
    const a = lows[i - 1];
    const b = lows[i];
    const aInd = nearest(a.index, 'low');
    const bInd = nearest(b.index, 'low');
    if (!aInd || !bInd) continue;

    if (b.value < a.value && bInd.value > aInd.value) {
      found.push({
        kind: 'bullish',
        indicator,
        price_points: [
          { ts: candles[a.index].timestamp, price: a.value },
          { ts: candles[b.index].timestamp, price: b.value },
        ],
        indicator_points: [
          { ts: candles[aInd.index].timestamp, value: aInd.value },
          { ts: candles[bInd.index].timestamp, value: bInd.value },
        ],
      });
    } else if (b.value > a.value && bInd.value < aInd.value) {
      found.push({
        kind: 'hidden_bullish',
        indicator,
        price_points: [
          { ts: candles[a.index].timestamp, price: a.value },
          { ts: candles[b.index].timestamp, price: b.value },
        ],
        indicator_points: [
          { ts: candles[aInd.index].timestamp, value: aInd.value },
          { ts: candles[bInd.index].timestamp, value: bInd.value },
        ],
      });
    }
  }

  for (let i = 1; i < highs.length; i++) {
    const a = highs[i - 1];
    const b = highs[i];
    const aInd = nearest(a.index, 'high');
    const bInd = nearest(b.index, 'high');
    if (!aInd || !bInd) continue;

    if (b.value > a.value && bInd.value < aInd.value) {
      found.push({
        kind: 'bearish',
        indicator,
        price_points: [
          { ts: candles[a.index].timestamp, price: a.value },
          { ts: candles[b.index].timestamp, price: b.value },
        ],
        indicator_points: [
          { ts: candles[aInd.index].timestamp, value: aInd.value },
          { ts: candles[bInd.index].timestamp, value: bInd.value },
        ],
      });
    } else if (b.value < a.value && bInd.value > aInd.value) {
      found.push({
        kind: 'hidden_bearish',
        indicator,
        price_points: [
          { ts: candles[a.index].timestamp, price: a.value },
          { ts: candles[b.index].timestamp, price: b.value },
        ],
        indicator_points: [
          { ts: candles[aInd.index].timestamp, value: aInd.value },
          { ts: candles[bInd.index].timestamp, value: bInd.value },
        ],
      });
    }
  }

  return found;
}

/**
 * Compose the full momentum summary.
 */
export function momentumSummary(candles: Candle[]): MomentumSummary {
  const rsiSeries = rsi(candles);
  const macdData = macd(candles);

  const lastRsi = rsiSeries[rsiSeries.length - 1] ?? 50;
  let rsiState: MomentumSummary['rsi_state'];
  if (lastRsi >= 70) rsiState = 'overbought';
  else if (lastRsi <= 30) rsiState = 'oversold';
  else rsiState = 'neutral';

  const allDivs = [
    ...detectDivergences(candles, 'rsi'),
    ...detectDivergences(candles, 'macd'),
  ];

  const byKind: Record<'bullish' | 'bearish' | 'hidden_bullish' | 'hidden_bearish', number> = {
    bullish: 0, bearish: 0, hidden_bullish: 0, hidden_bearish: 0,
  };
  for (const d of allDivs) byKind[d.kind]++;

  // Sort by timestamp of the latest price point, take 3 most recent
  const recent = allDivs
    .map(d => {
      const latest = d.price_points[d.price_points.length - 1];
      return { kind: d.kind, indicator: d.indicator, ts: latest.ts, price: latest.price };
    })
    .sort((a, b) => b.ts - a.ts)
    .slice(0, 3);

  return {
    rsi: Number.isFinite(lastRsi) ? lastRsi : 50,
    rsi_state: rsiState,
    macd_cross: detectMacdCross(candles),
    macd_histogram: macdData.histogram[macdData.histogram.length - 1] ?? 0,
    divergences: {
      count: allDivs.length,
      by_kind: byKind,
      recent,
    },
  };
}
