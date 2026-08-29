import { analyzeSession } from '../../compression/analyze.js';
import type { TradeThesis } from '../../compression/thesis.js';
import { createAnalysisId, type AnalysisProvider, type AnalysisRecord } from '../../domain/analysis/model.js';
import { validateTradeThesis } from '../../domain/analysis/validateTradeThesis.js';
import { normalizeSymbol, type DatasetRecord } from '../../domain/dataset/model.js';
import type { ActiveDatasetSource } from '../ports/activeDatasetSource.js';
import type { AnalysisRepository } from '../ports/analysisRepository.js';
import type { DatasetRepository } from '../ports/datasetRepository.js';

export class ResolveThesisArtifactUseCase {
  constructor(
    private readonly datasets: DatasetRepository,
    private readonly analyses: AnalysisRepository,
    private readonly legacySource: ActiveDatasetSource,
    private readonly now: () => number = Date.now,
  ) {}

  async resolve(analysisId?: string): Promise<AnalysisRecord> {
    const dataset = await this.requireActiveDataset();
    if (analysisId) {
      const artifact = await this.analyses.get(createAnalysisId(analysisId));
      if (!artifact) throw new Error(`Analysis ${analysisId} not found.`);
      if (artifact.datasetId !== dataset.datasetId) {
        throw new Error(`Analysis ${artifact.analysisId} is stale for active dataset ${dataset.datasetId}.`);
      }
      await this.analyses.setActive(artifact.analysisId);
      return artifact;
    }
    const active = await this.analyses.getActive();
    if (active?.datasetId === dataset.datasetId) return active;
    const latest = await this.analyses.latestFor(dataset.datasetId);
    if (latest) {
      await this.analyses.setActive(latest.analysisId);
      return latest;
    }
    const analysis = analyzeSession([...dataset.candles]);
    return this.save(dataset, 'local', analysis.thesis);
  }

  async findExisting(provider?: AnalysisProvider): Promise<AnalysisRecord | null> {
    const dataset = await this.requireActiveDataset();
    const artifact = await this.analyses.latestFor(dataset.datasetId);
    return artifact && (!provider || artifact.provider === provider) ? artifact : null;
  }

  async storeGatewayThesis(value: unknown): Promise<AnalysisRecord> {
    const dataset = await this.requireActiveDataset();
    const thesis = validateTradeThesis(value);
    const existing = await this.analyses.latestFor(dataset.datasetId);
    if (existing?.provider === 'gateway' && JSON.stringify(existing.thesis) === JSON.stringify(thesis)) {
      await this.analyses.setActive(existing.analysisId);
      return existing;
    }
    return this.save(dataset, 'gateway', thesis);
  }

  private async save(
    dataset: DatasetRecord,
    provider: AnalysisProvider,
    thesis: TradeThesis,
  ): Promise<AnalysisRecord> {
    const local = analyzeSession([...dataset.candles]);
    const artifact = await this.analyses.save({
      datasetId: dataset.datasetId,
      provider,
      summary: local.summary,
      thesis,
      schemaVersion: 'thesis-v1',
      createdAt: this.now(),
    });
    await this.analyses.setActive(artifact.analysisId);
    return artifact;
  }

  private async requireActiveDataset(): Promise<DatasetRecord> {
    const active = await this.datasets.getActive();
    if (active) return active;
    const legacy = this.legacySource.read();
    if (!legacy) {
      throw new Error('No candle data loaded. Call romaco_load_candles first with source, symbol, and timeframe.');
    }
    const record = await this.datasets.save({
      ...legacy,
      symbol: normalizeSymbol(legacy.symbol),
      candles: [...legacy.candles],
    });
    await this.datasets.setActive(record.datasetId);
    await this.analyses.clearActive();
    return record;
  }
}
