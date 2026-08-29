import type { DatasetDraft, DatasetId, DatasetRecord } from '../../domain/dataset/model.js';

export interface DatasetRepository {
  save(draft: DatasetDraft): Promise<DatasetRecord>;
  get(datasetId: DatasetId): Promise<DatasetRecord | null>;
  getActive(): Promise<DatasetRecord | null>;
  setActive(datasetId: DatasetId): Promise<void>;
  clearActive(): Promise<void>;
  clear(): Promise<void>;
}
