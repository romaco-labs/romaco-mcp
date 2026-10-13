import type { MarketSummary } from '../../compression/types.js';
import type { TradeThesis } from '../../compression/thesis.js';
import type { DatasetId } from '../dataset/model.js';

declare const analysisIdBrand: unique symbol;

export type AnalysisId = string & { readonly [analysisIdBrand]: 'AnalysisId' };

export type AnalysisProvider = 'local' | 'gateway';

export interface AnalysisPayload {
  provider: AnalysisProvider;
  summary: MarketSummary;
  thesis: TradeThesis;
  schemaVersion: string;
}

/** Exact data an analysis was computed from; see DatasetProvenance. */
export interface AnalysisDataProvenance {
  datasetHash: string;
  asOf: number;
}

export interface AnalysisDraft extends AnalysisPayload {
  datasetId: DatasetId;
  createdAt: number;
  /** Absent only on artifacts stored before provenance v1. */
  dataProvenance?: AnalysisDataProvenance;
}

export interface AnalysisRecord extends AnalysisDraft {
  analysisId: AnalysisId;
}

export function createAnalysisId(value: string): AnalysisId {
  const normalized = value.trim();
  if (!normalized) throw new Error('AnalysisId cannot be empty.');
  return normalized as AnalysisId;
}
