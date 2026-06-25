import type { Candle, Swing } from './types.js';
import { atr } from './volatility.js';

/**
 * Shared pivot engine.
 *
 * One implementation of local-extreme detection, consumed by:
 *   - patterns.ts  `findSwings`        (candle swings for pattern detectors)
 *   - levels.ts    `findSwingExtremes` (swing prices for k-means levels)
 *   - momentum.ts  divergence pivots   (generic numeric series)
 *
 * A pivot at index i is confirmed when its value is the strict extreme over
 * [i-lookback, i+lookback] — ties disqualify, matching the historical
 * behavior of all three former copies.
 */

export interface SeriesPivot {
  index: number;
  value: number;
  kind: 'high' | 'low';
}

/**
 * Find local extremes in a numeric series. NaN-safe: NaN entries are neither
 * pivots nor disqualifiers (momentum semantics — indicator warm-up produces
 * leading NaNs).
 */
export function findPivotsInSeries(values: number[], lookback = 3): SeriesPivot[] {
  const pivots: SeriesPivot[] = [];
  for (let i = lookback; i < values.length - lookback; i++) {
    if (Number.isNaN(values[i])) continue;
    let isHigh = true;
    let isLow = true;
    for (let j = i - lookback; j <= i + lookback; j++) {
      if (j === i || Number.isNaN(values[j])) continue;
      if (values[j] >= values[i]) isHigh = false;
      if (values[j] <= values[i]) isLow = false;
    }
    if (isHigh) pivots.push({ index: i, value: values[i], kind: 'high' });
    if (isLow) pivots.push({ index: i, value: values[i], kind: 'low' });
  }
  return pivots;
}

/**
 * Candle swings: swing highs from the highs series, swing lows from the lows
 * series, in index order (high before low when both land on one candle —
 * identical output to the former patterns.ts implementation).
 */
export function findCandleSwings(candles: Candle[], lookback = 3): Swing[] {
  const highPivots = new Map(
    findPivotsInSeries(candles.map((c) => c.high), lookback)
      .filter((p) => p.kind === 'high')
      .map((p) => [p.index, p.value]),
  );
  const lowPivots = new Map(
    findPivotsInSeries(candles.map((c) => c.low), lookback)
      .filter((p) => p.kind === 'low')
      .map((p) => [p.index, p.value]),
  );
  const swings: Swing[] = [];
  for (let i = 0; i < candles.length; i++) {
    const h = highPivots.get(i);
    if (h !== undefined) swings.push({ ts: candles[i].timestamp, price: h, index: i, kind: 'high' });
    const l = lowPivots.get(i);
    if (l !== undefined) swings.push({ ts: candles[i].timestamp, price: l, index: i, kind: 'low' });
  }
  return swings;
}

/**
 * Zigzag: reduce raw swings to a strictly alternating high/low sequence.
 *
 * - A same-kind successor replaces the previous swing if it is more extreme
 *   (higher high / lower low).
 * - An opposite-kind successor is accepted only when the reversal magnitude
 *   reaches `minReversal` — smaller wiggles are noise, not structure.
 *
 * Geometric detectors (channels, wedges, cup) consume zigzag output so their
 * trendline fits see structure, not every 3-bar blip.
 */
export function zigzagFilter(swings: Swing[], minReversal: number): Swing[] {
  const out: Swing[] = [];
  for (const s of swings) {
    const last = out[out.length - 1];
    if (!last) {
      out.push(s);
      continue;
    }
    if (s.kind === last.kind) {
      const moreExtreme = s.kind === 'high' ? s.price > last.price : s.price < last.price;
      if (moreExtreme) out[out.length - 1] = s;
    } else if (Math.abs(s.price - last.price) >= minReversal) {
      out.push(s);
    }
  }
  return out;
}

/**
 * Reversal threshold for zigzag, scaled to the instrument's volatility:
 * last finite ATR(14) × mult. Falls back to a fraction of the last close when
 * ATR is unavailable (short series).
 */
export function minReversalFromAtr(candles: Candle[], mult = 1.0, fallbackPct = 0.005): number {
  const series = atr(candles);
  for (let i = series.length - 1; i >= 0; i--) {
    if (!Number.isNaN(series[i]) && series[i] > 0) return series[i] * mult;
  }
  const lastClose = candles.length ? candles[candles.length - 1].close : 0;
  return lastClose * fallbackPct;
}
