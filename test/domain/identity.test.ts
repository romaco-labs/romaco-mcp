import { describe, expect, it } from 'vitest';
import { createAnalysisId } from '../../src/domain/analysis/model.js';
import { createChartId } from '../../src/domain/chart/model.js';
import { createDatasetId } from '../../src/domain/dataset/model.js';

describe('domain identities', () => {
  it('normalizes non-empty ids', () => {
    expect(createDatasetId(' dataset_a ')).toBe('dataset_a');
    expect(createAnalysisId(' analysis_a ')).toBe('analysis_a');
    expect(createChartId(' chart_a ')).toBe('chart_a');
  });

  it('rejects blank ids', () => {
    expect(() => createDatasetId('  ')).toThrow(/DatasetId/);
    expect(() => createAnalysisId('')).toThrow(/AnalysisId/);
    expect(() => createChartId('\n')).toThrow(/ChartId/);
  });
});
