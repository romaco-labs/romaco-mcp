import type { AnalysisPayload } from '../../domain/analysis/model.js';
import type { DatasetRecord } from '../../domain/dataset/model.js';

export interface AnalysisGatewayPort {
  enabled(): boolean;
  analyze(dataset: DatasetRecord): Promise<AnalysisPayload>;
}
