import type { AnalysisDraft, AnalysisId, AnalysisRecord } from '../../domain/analysis/model.js';
import type { DatasetId } from '../../domain/dataset/model.js';

export interface AnalysisRepository {
  save(draft: AnalysisDraft): Promise<AnalysisRecord>;
  get(analysisId: AnalysisId): Promise<AnalysisRecord | null>;
  latestFor(datasetId: DatasetId): Promise<AnalysisRecord | null>;
  getActive(): Promise<AnalysisRecord | null>;
  setActive(analysisId: AnalysisId): Promise<void>;
  clearActive(): Promise<void>;
  clear(): Promise<void>;
}
