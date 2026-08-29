import { randomUUID } from 'node:crypto';
import type { DatasetRepository } from '../../../application/ports/datasetRepository.js';
import {
  createDatasetId,
  type DatasetDraft,
  type DatasetId,
  type DatasetRecord,
} from '../../../domain/dataset/model.js';

export type RepositoryIdFactory = () => string;

export class InMemoryDatasetRepository implements DatasetRepository {
  private readonly records = new Map<DatasetId, DatasetRecord>();
  private activeId: DatasetId | null = null;

  constructor(private readonly createId: RepositoryIdFactory = randomUUID) {}

  async save(draft: DatasetDraft): Promise<DatasetRecord> {
    const datasetId = createDatasetId(`dataset_${this.createId()}`);
    const record: DatasetRecord = Object.freeze({
      ...draft,
      datasetId,
      candles: Object.freeze([...draft.candles]),
    });
    this.records.set(datasetId, record);
    return record;
  }

  async get(datasetId: DatasetId): Promise<DatasetRecord | null> {
    return this.records.get(datasetId) ?? null;
  }

  async getActive(): Promise<DatasetRecord | null> {
    return this.activeId ? this.records.get(this.activeId) ?? null : null;
  }

  async setActive(datasetId: DatasetId): Promise<void> {
    if (!this.records.has(datasetId)) {
      throw new Error(`Dataset ${datasetId} not found.`);
    }
    this.activeId = datasetId;
  }

  async clearActive(): Promise<void> {
    this.activeId = null;
  }

  async clear(): Promise<void> {
    this.records.clear();
    this.activeId = null;
  }
}
