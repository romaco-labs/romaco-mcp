import { describe, expect, it, vi } from 'vitest';
import { InMemoryAnalysisRepository } from '../../src/adapters/outbound/persistence/InMemoryAnalysisRepository.js';
import { InMemoryDatasetRepository } from '../../src/adapters/outbound/persistence/InMemoryDatasetRepository.js';
import { AnalyzeBatchUseCase } from '../../src/application/use-cases/analyzeBatch.js';
import { LoadDatasetUseCase } from '../../src/application/use-cases/loadDataset.js';
import { SerializedActiveSessionActivation } from '../../src/application/use-cases/serializedActiveSessionActivation.js';
import type { MarketSummary } from '../../src/compression/types.js';
import type { TradeThesis } from '../../src/compression/thesis.js';

const candles = [{ timestamp: 1, open: 10, high: 12, low: 9, close: 11, volume: 100 }];

function thesis(): TradeThesis {
  return {
    bias: 'bullish',
    verdict: 'long',
    confidence: 0.8,
    bull: [],
    bear: [],
    setup: { entry: 10, stop: 9, target: 12, rr: 2, basis: 'fixture' },
    invalidation: { price: 9, reason: 'fixture' },
    horizon: 'swing',
    notes: [],
  };
}

describe('SerializedActiveSessionActivation', () => {
  it('serializes forced LoadDataset/AnalyzeBatch interleaving into one consistent final tuple', async () => {
    let datasetNumber = 0;
    let analysisNumber = 0;
    const datasets = new InMemoryDatasetRepository(() => String(++datasetNumber));
    const analyses = new InMemoryAnalysisRepository(() => String(++analysisNumber));
    const projected: string[] = [];
    const activation = new SerializedActiveSessionActivation(datasets, analyses, {
      replace: (dataset) => { projected.push(dataset.symbol); },
    });
    const loadDataset = new LoadDatasetUseCase({
      load: vi.fn(async ({ symbol, timeframe }) => ({
        source: 'yfinance' as const,
        symbol,
        timeframe,
        candles,
        fetchedAt: 1,
      })),
    }, datasets, activation);
    const resolveForDataset = vi.fn(async (datasetId: string) => analyses.save({
      datasetId: datasetId as never,
      provider: 'local',
      summary: {} as MarketSummary,
      thesis: thesis(),
      schemaVersion: 'thesis-v1',
      createdAt: 1,
    }));
    const batch = new AnalyzeBatchUseCase(
      loadDataset,
      { resolveForDataset } as never,
      activation,
    );

    const originalSetActive = datasets.setActive.bind(datasets);
    const activationCalls: string[] = [];
    let enteredFirstActivation: (() => void) | undefined;
    let releaseFirstActivation: (() => void) | undefined;
    const firstActivationEntered = new Promise<void>((resolve) => { enteredFirstActivation = resolve; });
    const firstActivationRelease = new Promise<void>((resolve) => { releaseFirstActivation = resolve; });
    let holdFirst = true;
    vi.spyOn(datasets, 'setActive').mockImplementation(async (datasetId) => {
      activationCalls.push(datasetId);
      await originalSetActive(datasetId);
      if (holdFirst) {
        holdFirst = false;
        enteredFirstActivation?.();
        await firstActivationRelease;
      }
    });

    const direct = loadDataset.execute({ source: 'yfinance', symbol: 'AAPL', timeframe: '1d' });
    await firstActivationEntered;
    const ranked = batch.execute({ symbols: ['SPY'], timeframe: '1d', lookback: 100 });
    await vi.waitFor(() => expect(resolveForDataset).toHaveBeenCalledOnce());

    // Batch commit reached shared lane but cannot interleave its repository writes.
    expect(activationCalls).toHaveLength(1);
    releaseFirstActivation?.();
    const [, batchResult] = await Promise.all([direct, ranked]);

    expect(activationCalls).toHaveLength(2);
    expect((await datasets.getActive())?.datasetId).toBe(batchResult.top.dataset.datasetId);
    expect((await analyses.getActive())?.analysisId).toBe(batchResult.top.artifact.analysisId);
    expect((await analyses.getActive())?.datasetId).toBe((await datasets.getActive())?.datasetId);
    expect(projected.at(-1)).toBe(batchResult.top.dataset.symbol);
  });
});
