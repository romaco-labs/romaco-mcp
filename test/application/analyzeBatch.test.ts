import { describe, expect, it, vi } from 'vitest';
import { AnalyzeBatchUseCase } from '../../src/application/use-cases/analyzeBatch.js';
import { createAnalysisId } from '../../src/domain/analysis/model.js';
import { createDatasetId } from '../../src/domain/dataset/model.js';

const candles = [{ timestamp: 1, open: 1, high: 2, low: 1, close: 2, volume: 1 }];

function dataset(symbol: string) {
  return {
    datasetId: createDatasetId(`dataset_${symbol.toLowerCase()}`),
    source: 'yfinance' as const,
    symbol,
    timeframe: '1d' as const,
    candles,
    fetchedAt: 1,
  };
}

function artifact(symbol: string, rr: number, confidence: number) {
  const item = dataset(symbol);
  return {
    analysisId: createAnalysisId(`analysis_${symbol.toLowerCase()}`),
    datasetId: item.datasetId,
    provider: 'local' as const,
    summary: {} as never,
    thesis: {
      bias: 'bullish' as const,
      verdict: 'long' as const,
      confidence,
      bull: [],
      bear: [],
      setup: { entry: 10, stop: 9, target: 10 + rr, rr, basis: 'fixture' },
      invalidation: { price: 9, reason: 'stop' },
      horizon: 'swing' as const,
      notes: [],
    },
    schemaVersion: 'thesis-v1',
    createdAt: 1,
  };
}

describe('AnalyzeBatchUseCase', () => {
  it('preserves successes, ranks deterministically, and activates exact top identities', async () => {
    const datasets = new Map([['AAPL', dataset('AAPL')], ['SPY', dataset('SPY')]]);
    const artifacts = new Map([
      [createDatasetId('dataset_aapl'), artifact('AAPL', 2, 0.5)],
      [createDatasetId('dataset_spy'), artifact('SPY', 3, 0.8)],
    ]);
    const activateAnalysis = vi.fn();
    const useCase = new AnalyzeBatchUseCase(
      {
        loadDetached: vi.fn(async ({ symbol }: { symbol: string }) => {
          if (symbol === 'MISSING') throw new Error('unavailable');
          return datasets.get(symbol)!;
        }),
      } as never,
      {
        resolveForDataset: vi.fn(async (datasetId: string) => artifacts.get(createDatasetId(datasetId))!),
      } as never,
      { activateDataset: vi.fn(), activateAnalysis },
    );

    const result = await useCase.execute({
      symbols: ['aapl', 'SPY', 'MISSING'], timeframe: '1d', lookback: 300,
    });

    expect(result.items.map((item) => item.dataset.symbol)).toEqual(['SPY', 'AAPL']);
    expect(result.failures).toEqual([{ symbol: 'MISSING', message: 'unavailable' }]);
    expect(activateAnalysis).toHaveBeenCalledWith(
      dataset('SPY'),
      artifact('SPY', 3, 0.8),
    );
  });

  it('preserves prior active state when detached load succeeds but analysis fails', async () => {
    const activateAnalysis = vi.fn();
    const useCase = new AnalyzeBatchUseCase(
      { loadDetached: vi.fn(async () => dataset('AAPL')) } as never,
      { resolveForDataset: vi.fn(async () => { throw new Error('analysis failed'); }) } as never,
      { activateDataset: vi.fn(), activateAnalysis },
    );

    await expect(useCase.execute({ symbols: ['AAPL'], timeframe: '1d', lookback: 300 }))
      .rejects.toThrow('All requested symbols failed');
    expect(activateAnalysis).not.toHaveBeenCalled();
  });
});
