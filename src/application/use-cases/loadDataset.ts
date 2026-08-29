import type { ActiveDatasetProjection } from '../ports/activeDatasetProjection.js';
import type { AnalysisRepository } from '../ports/analysisRepository.js';
import type { DatasetRepository } from '../ports/datasetRepository.js';
import type { LoadMarketDataRequest, MarketDataPort } from '../ports/marketData.js';
import { normalizeSymbol, type DatasetRecord } from '../../domain/dataset/model.js';

export class LoadDatasetUseCase {
  constructor(
    private readonly marketData: MarketDataPort,
    private readonly datasets: DatasetRepository,
    private readonly analyses: AnalysisRepository,
    private readonly activeProjection: ActiveDatasetProjection,
  ) {}

  async execute(request: LoadMarketDataRequest): Promise<DatasetRecord> {
    const symbol = normalizeSymbol(request.symbol);
    const loaded = await this.marketData.load({ ...request, symbol });
    const record = await this.datasets.save({
      ...loaded,
      symbol,
      timeframe: request.timeframe,
    });

    // Publish active state only after loading and persistence both succeed.
    await this.datasets.setActive(record.datasetId);
    await this.analyses.clearActive();
    this.activeProjection.replace(record);
    return record;
  }
}
