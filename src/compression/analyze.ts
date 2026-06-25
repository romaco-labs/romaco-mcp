import type { Candle, MarketSummary } from './types.js';
import { memoScan } from './scanCache.js';
import { composeMarketSummary } from './summary.js';
import { composeThesis, type TradeThesis } from './thesis.js';

export interface SessionAnalysis {
  summary: MarketSummary;
  thesis: TradeThesis;
}

/**
 * Single analysis entry point: builds the MarketSummary and the thesis FROM it,
 * so every consumer (romaco_thesis, romaco_annotate) reasons over the SAME
 * numbers. The verdict the user is told and the levels/setup annotate draws come
 * from one MarketSummary instance — they cannot drift.
 *
 * Memoized per candle array (scanCache.ts): thesis → annotate on the same
 * load analyzes once and reuses the frozen result.
 */
export function analyzeSession(candles: Candle[]): SessionAnalysis {
  return memoScan(candles, 'analysis', () => {
    const summary = composeMarketSummary(candles);
    return { summary, thesis: composeThesis(summary) };
  });
}
