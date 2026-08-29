import type { AnalysisRecord } from '../../domain/analysis/model.js';
import type { DatasetRecord, Timeframe } from '../../domain/dataset/model.js';
import type { ActiveSessionActivationPort } from '../ports/activeSessionActivation.js';
import type { LoadDatasetUseCase } from './loadDataset.js';
import type { ResolveThesisArtifactUseCase } from './resolveThesisArtifact.js';

export interface AnalyzeBatchRequest {
  symbols: readonly string[];
  timeframe: Timeframe;
  lookback: number;
}

export interface AnalyzeBatchItem {
  dataset: DatasetRecord;
  artifact: AnalysisRecord;
  score: number;
}

export interface AnalyzeBatchFailure {
  symbol: string;
  message: string;
}

export interface AnalyzeBatchResult {
  items: AnalyzeBatchItem[];
  top: AnalyzeBatchItem;
  failures: AnalyzeBatchFailure[];
}

/** Multi-symbol orchestration over ports; final active state always equals ranked top pick. */
export class AnalyzeBatchUseCase {
  constructor(
    private readonly loadDataset: LoadDatasetUseCase,
    private readonly resolveThesis: ResolveThesisArtifactUseCase,
    private readonly activation: ActiveSessionActivationPort,
  ) {}

  async execute(request: AnalyzeBatchRequest): Promise<AnalyzeBatchResult> {
    const symbols = [...new Set(request.symbols.map((symbol) => symbol.trim().toUpperCase()))]
      .filter(Boolean);
    const items: AnalyzeBatchItem[] = [];
    const failures: AnalyzeBatchFailure[] = [];
    for (const symbol of symbols) {
      try {
        const dataset = await this.loadDataset.loadDetached({
          source: 'yfinance',
          symbol,
          timeframe: request.timeframe,
          lookback: request.lookback,
        });
        const artifact = await this.resolveThesis.resolveForDataset(dataset.datasetId);
        const setup = artifact.thesis.setup;
        items.push({
          dataset,
          artifact,
          score: setup ? setup.rr * artifact.thesis.confidence : 0,
        });
      } catch (error) {
        failures.push({ symbol, message: error instanceof Error ? error.message : String(error) });
      }
    }
    if (items.length === 0) throw new Error('All requested symbols failed to load.');
    items.sort((left, right) =>
      right.score - left.score
      || right.artifact.thesis.confidence - left.artifact.thesis.confidence
      || left.dataset.symbol.localeCompare(right.dataset.symbol)
    );
    const top = items[0];
    await this.activation.activateAnalysis(top.dataset, top.artifact);
    return { items, top, failures };
  }
}
