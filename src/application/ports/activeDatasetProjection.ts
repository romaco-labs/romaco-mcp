import type { DatasetRecord } from '../../domain/dataset/model.js';

/** Temporary compatibility projection for legacy session-based tools. */
export interface ActiveDatasetProjection {
  replace(dataset: DatasetRecord): void;
}
