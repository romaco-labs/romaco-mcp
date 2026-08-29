import { randomUUID } from 'node:crypto';
import type { AnalysisRepository } from '../../../application/ports/analysisRepository.js';
import {
  createAnalysisId,
  type AnalysisDraft,
  type AnalysisId,
  type AnalysisRecord,
} from '../../../domain/analysis/model.js';
import type { DatasetId } from '../../../domain/dataset/model.js';
import type { RepositoryIdFactory } from './InMemoryDatasetRepository.js';

export class InMemoryAnalysisRepository implements AnalysisRepository {
  private readonly records = new Map<AnalysisId, AnalysisRecord>();
  private readonly latestByDataset = new Map<DatasetId, AnalysisId>();
  private activeId: AnalysisId | null = null;

  constructor(private readonly createId: RepositoryIdFactory = randomUUID) {}

  async save(draft: AnalysisDraft): Promise<AnalysisRecord> {
    const analysisId = createAnalysisId(`analysis_${this.createId()}`);
    const record: AnalysisRecord = Object.freeze({ ...draft, analysisId });
    this.records.set(analysisId, record);
    this.latestByDataset.set(draft.datasetId, analysisId);
    return record;
  }

  async get(analysisId: AnalysisId): Promise<AnalysisRecord | null> {
    return this.records.get(analysisId) ?? null;
  }

  async latestFor(datasetId: DatasetId): Promise<AnalysisRecord | null> {
    const analysisId = this.latestByDataset.get(datasetId);
    return analysisId ? this.records.get(analysisId) ?? null : null;
  }

  async getActive(): Promise<AnalysisRecord | null> {
    return this.activeId ? this.records.get(this.activeId) ?? null : null;
  }

  async setActive(analysisId: AnalysisId): Promise<void> {
    if (!this.records.has(analysisId)) {
      throw new Error(`Analysis ${analysisId} not found.`);
    }
    this.activeId = analysisId;
  }

  async clearActive(): Promise<void> {
    this.activeId = null;
  }

  async clear(): Promise<void> {
    this.records.clear();
    this.latestByDataset.clear();
    this.activeId = null;
  }
}
