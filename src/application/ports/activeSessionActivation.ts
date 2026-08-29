import type { AnalysisRecord } from '../../domain/analysis/model.js';
import type { DatasetRecord } from '../../domain/dataset/model.js';

/** Publishes one internally consistent process-global active-session tuple. */
export interface ActiveSessionActivationPort {
  activateDataset(dataset: DatasetRecord): Promise<void>;
  activateAnalysis(dataset: DatasetRecord, analysis: AnalysisRecord): Promise<void>;
}
