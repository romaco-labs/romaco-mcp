import type { MarketDataPort, LoadMarketDataRequest } from '../application/ports/marketData.js';
import type { DatasetDraft } from '../domain/dataset/model.js';
import { loadCandles } from '../data/loader.js';

/** Strangler adapter around the existing loader until data sources migrate. */
export class LegacyMarketDataAdapter implements MarketDataPort {
  async load(request: LoadMarketDataRequest): Promise<DatasetDraft> {
    const loaded = await loadCandles({
      source: request.source,
      symbol: request.symbol,
      timeframe: request.timeframe,
      lookback: request.lookback,
      rawCandles: request.rawCandles ? [...request.rawCandles] : undefined,
    });
    return {
      source: loaded.source,
      symbol: loaded.symbol,
      timeframe: loaded.timeframe,
      candles: loaded.candles,
      fetchedAt: loaded.fetched_at,
    };
  }
}
