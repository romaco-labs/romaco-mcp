import type { ActiveDatasetProjection } from '../application/ports/activeDatasetProjection.js';
import type { DatasetRecord } from '../domain/dataset/model.js';
import { session } from '../session.js';

export class LegacySessionProjection implements ActiveDatasetProjection {
  replace(dataset: DatasetRecord): void {
    session.setLastLoad({
      datasetId: dataset.datasetId,
      source: dataset.source,
      symbol: dataset.symbol,
      timeframe: dataset.timeframe,
      candles: [...dataset.candles],
      fetched_at: dataset.fetchedAt,
    });
  }
}
