import type { ActiveDatasetSource } from '../application/ports/activeDatasetSource.js';
import type { DatasetDraft } from '../domain/dataset/model.js';
import { session } from '../session.js';

export class LegacySessionDatasetSource implements ActiveDatasetSource {
  read(): DatasetDraft | null {
    const load = session.getLastLoad();
    if (!load) return null;
    return {
      source: load.source,
      symbol: load.symbol,
      timeframe: load.timeframe,
      candles: [...load.candles],
      fetchedAt: load.fetched_at,
      ...(load.served_at === undefined ? {} : { servedAt: load.served_at }),
      ...(load.cache_hit === undefined ? {} : { cacheHit: load.cache_hit }),
    };
  }
}
