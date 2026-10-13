import type { AnalysisProvider } from './model.js';

/** Local thesis confidence measures evidence agreement/mass, not outcome frequency. */
export const LOCAL_CONFIDENCE_SEMANTICS = {
  kind: 'heuristic_evidence_score',
  method: 'evidence_agreement_mass_v1',
  version: '1',
  calibrated: false,
  isProbability: false,
} as const;

/** Stored gateway artifacts have no validated calibration contract yet. */
export const UNVERIFIED_PROVIDER_CONFIDENCE_SEMANTICS = {
  kind: 'unverified_provider_score',
  method: 'provider_unverified',
  version: null,
  calibrated: false,
  isProbability: false,
} as const;

/** R/R multiplied by an uncalibrated score is only a ranking heuristic. */
export const BATCH_SCORE_SEMANTICS = {
  kind: 'heuristic_rank',
  method: 'setup_rr_times_confidence_v1',
  version: '1',
  isProbability: false,
  isExpectedReturn: false,
} as const;

export function confidenceSemanticsFor(provider: AnalysisProvider) {
  return provider === 'local'
    ? LOCAL_CONFIDENCE_SEMANTICS
    : UNVERIFIED_PROVIDER_CONFIDENCE_SEMANTICS;
}
