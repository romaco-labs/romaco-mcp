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
      levels: { support: [], resistance: [], poc: 0, vah: 0, val: 0 },
      momentum: {
        rsi: 50,
        rsi_state: 'neutral',
        macd_cross: 'none',
        macd_histogram: 0,
        divergences: { count: 0, by_kind: { bullish: 0, bearish: 0, hidden_bullish: 0, hidden_bearish: 0 }, recent: [] },
      },
      volatility: { atr: 0, atr_pct: 0, bb_squeeze: false, bb_width_pct: 0, state: 'stable' },
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
