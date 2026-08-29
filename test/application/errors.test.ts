import { describe, expect, it } from 'vitest';
import { ApplicationError, toApplicationError } from '../../src/application/errors.js';

describe('ApplicationError', () => {
  it('exposes a transport-neutral, JSON-safe DTO', () => {
    const error = new ApplicationError('CHART_CONTEXT_MISMATCH', 'Chart symbol differs.', {
      recovery: {
        action: 'match_chart_identity',
        instruction: 'Select the chart that matches the analysis.',
        parameters: { expectedSymbol: 'AAPL', actualSymbol: 'TSLA' },
      },
      details: { chartId: 'chart_1' },
    });

    expect(error.toDTO()).toEqual({
      code: 'CHART_CONTEXT_MISMATCH',
      message: 'Chart symbol differs.',
      retryable: false,
      recovery: {
        action: 'match_chart_identity',
        instruction: 'Select the chart that matches the analysis.',
        parameters: { expectedSymbol: 'AAPL', actualSymbol: 'TSLA' },
      },
      details: { chartId: 'chart_1' },
    });
  });

  it('normalizes unknown failures without exposing their message', () => {
    const normalized = toApplicationError(new Error('secret upstream response'));
    expect(normalized.toDTO()).toMatchObject({
      code: 'INTERNAL',
      message: 'Unexpected internal error.',
      retryable: false,
    });
    expect(normalized.message).not.toContain('secret');
  });
});
