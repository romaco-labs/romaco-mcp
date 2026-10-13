import type { Candle, MarketSummary } from './types.js';
import { detectTrend, piecewiseLinear } from './trend.js';
import { findLevels } from './levels.js';
import { momentumSummary } from './momentum.js';
import { volatilitySummary } from './volatility.js';
import { cachedDetectPatterns, memoScan } from './scanCache.js';

/**
 * Compose the full MarketSummary from raw candles.
 * This is THE compression function: 500-10,000 candles → ~500 tokens of structured features.
 *
 * Pure function — deterministic, no I/O, no LLM calls. Memoized per candle
 * array (see scanCache.ts): repeat calls for the same loaded data return the
 * same deep-frozen instance instead of recomputing the scan.
 */
export function composeMarketSummary(candles: Candle[]): MarketSummary {
  if (candles.length === 0) {
    return {
      meta: { candle_count: 0, first_ts: 0, last_ts: 0, last_price: 0 },
      trend: { direction: 'sideways', strength: 0, duration_candles: 0, slope_pct_per_candle: 0 },
      plr: [],
      levels: { support: [], resistance: [], poc: null, vah: null, val: null, volume_status: 'insufficient' },
      momentum: {
        rsi: null,
        rsi_state: 'insufficient_data',
        macd_cross: 'insufficient_data',
        macd_histogram: null,
        divergences: { count: 0, by_kind: { bullish: 0, bearish: 0, hidden_bullish: 0, hidden_bearish: 0 }, recent: [] },
      },
      volatility: { atr: null, atr_pct: null, bb_squeeze: null, bb_width_pct: null, state: 'insufficient_data' },
      patterns: [],
    };
  }

  return memoScan(candles, 'summary', () => {
    const first = candles[0];
    const last = candles[candles.length - 1];
    const inferredTf =
      candles.length >= 2 ? candles[1].timestamp - candles[0].timestamp : undefined;

    return {
      meta: {
        candle_count: candles.length,
        timeframe_seconds: inferredTf,
        first_ts: first.timestamp,
        last_ts: last.timestamp,
        last_price: last.close,
      },
      trend: detectTrend(candles),
      plr: piecewiseLinear(candles),
      levels: findLevels(candles),
      momentum: momentumSummary(candles),
      volatility: volatilitySummary(candles),
      patterns: cachedDetectPatterns(candles),
    };
  });
}
