import type { DatasetDraft } from '../../domain/dataset/model.js';

export interface ActiveDatasetSource {
  read(): DatasetDraft | null;
}
