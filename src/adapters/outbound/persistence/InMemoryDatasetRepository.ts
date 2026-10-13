import { createHash, randomUUID } from 'node:crypto';
import type { DatasetRepository } from '../../../application/ports/datasetRepository.js';
import {
  createDatasetId,
  type DatasetDraft,
  type DatasetId,
  type DatasetRecord,
} from '../../../domain/dataset/model.js';
import {
  canonicalDatasetContent,
  describeProvenance,
  type DatasetProvenance,
} from '../../../domain/dataset/provenance.js';

export type RepositoryIdFactory = () => string;

function freezeProvenance(provenance: DatasetProvenance): DatasetProvenance {
  Object.freeze(provenance.coverage);
  if (provenance.lastBar) Object.freeze(provenance.lastBar);
  return Object.freeze(provenance);
}

export class InMemoryDatasetRepository implements DatasetRepository {
  private readonly records = new Map<DatasetId, DatasetRecord>();
  private activeId: DatasetId | null = null;

  constructor(private readonly createId: RepositoryIdFactory = randomUUID) {}

  async save(draft: DatasetDraft): Promise<DatasetRecord> {
    const datasetId = createDatasetId(`dataset_${this.createId()}`);
    const candles = Object.freeze([...draft.candles]);
    const hash = createHash('sha256').update(canonicalDatasetContent({ ...draft, candles })).digest('hex');
    const record: DatasetRecord = Object.freeze({
      ...draft,
      datasetId,
      candles,
      provenance: freezeProvenance(describeProvenance({ ...draft, candles }, `sha256:${hash}`)),
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
