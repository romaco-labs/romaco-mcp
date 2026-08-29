import { describe, expect, it, vi } from 'vitest';
import { InMemoryAnalysisRepository } from '../../src/adapters/outbound/persistence/InMemoryAnalysisRepository.js';
import { InMemoryDatasetRepository } from '../../src/adapters/outbound/persistence/InMemoryDatasetRepository.js';
import { LoadDatasetUseCase } from '../../src/application/use-cases/loadDataset.js';
import type { ActiveDatasetProjection } from '../../src/application/ports/activeDatasetProjection.js';
import type { MarketDataPort } from '../../src/application/ports/marketData.js';
import type { MarketSummary } from '../../src/compression/types.js';
import type { TradeThesis } from '../../src/compression/thesis.js';

const candles = [{ timestamp: 1, open: 10, high: 12, low: 9, close: 11, volume: 100 }];

describe('LoadDatasetUseCase', () => {
  it('activates a successful load, invalidates analysis, and updates compatibility projection', async () => {
    let datasetNumber = 0;
    const datasets = new InMemoryDatasetRepository(() => String(++datasetNumber));
    const analyses = new InMemoryAnalysisRepository(() => 'old');
    const oldDataset = await datasets.save({
      source: 'raw', symbol: 'OLD', timeframe: '1d', candles, fetchedAt: 1,
    });
    await datasets.setActive(oldDataset.datasetId);
    const oldAnalysis = await analyses.save({
      datasetId: oldDataset.datasetId,
      provider: 'local',
      summary: {} as MarketSummary,
      thesis: {} as TradeThesis,
      schemaVersion: '1',
      createdAt: 1,
    });
    await analyses.setActive(oldAnalysis.analysisId);

    const marketData: MarketDataPort = {
      load: vi.fn(async () => ({
        source: 'raw', symbol: 'ignored', timeframe: '1h', candles, fetchedAt: 2,
      })),
    };
    const replace = vi.fn();
    const projection: ActiveDatasetProjection = { replace };
    const useCase = new LoadDatasetUseCase(marketData, datasets, analyses, projection);

    const loaded = await useCase.execute({ source: 'raw', symbol: ' aapl ', timeframe: '1h' });

    expect(loaded.datasetId).toBe('dataset_2');
    expect(loaded.symbol).toBe('AAPL');
    expect(await datasets.getActive()).toBe(loaded);
    expect(await analyses.getActive()).toBeNull();
    expect(replace).toHaveBeenCalledWith(loaded);
  });

  it('preserves active dataset, analysis, and projection when loading fails', async () => {
    const datasets = new InMemoryDatasetRepository(() => 'old');
    const analyses = new InMemoryAnalysisRepository(() => 'old');
    const activeDataset = await datasets.save({
      source: 'raw', symbol: 'OLD', timeframe: '1d', candles, fetchedAt: 1,
    });
    await datasets.setActive(activeDataset.datasetId);
    const activeAnalysis = await analyses.save({
      datasetId: activeDataset.datasetId,
      provider: 'local',
      summary: {} as MarketSummary,
      thesis: {} as TradeThesis,
      schemaVersion: '1',
      createdAt: 1,
    });
    await analyses.setActive(activeAnalysis.analysisId);

    const failure = new Error('upstream unavailable');
    const marketData: MarketDataPort = { load: vi.fn(async () => { throw failure; }) };
    const replace = vi.fn();
    const useCase = new LoadDatasetUseCase(marketData, datasets, analyses, { replace });

    await expect(useCase.execute({
      source: 'yfinance', symbol: 'AAPL', timeframe: '1h',
    })).rejects.toBe(failure);
    expect(await datasets.getActive()).toBe(activeDataset);
    expect(await analyses.getActive()).toBe(activeAnalysis);
    expect(replace).not.toHaveBeenCalled();
  });

  it('loads a detached candidate without changing prior active state or projection', async () => {
    let datasetNumber = 0;
    const datasets = new InMemoryDatasetRepository(() => String(++datasetNumber));
    const analyses = new InMemoryAnalysisRepository(() => 'old');
    const activeDataset = await datasets.save({
      source: 'raw', symbol: 'OLD', timeframe: '1d', candles, fetchedAt: 1,
    });
    await datasets.setActive(activeDataset.datasetId);
    const activeAnalysis = await analyses.save({
      datasetId: activeDataset.datasetId,
      provider: 'local',
      summary: {} as MarketSummary,
      thesis: {} as TradeThesis,
      schemaVersion: '1',
      createdAt: 1,
    });
    await analyses.setActive(activeAnalysis.analysisId);
    const replace = vi.fn();
    const useCase = new LoadDatasetUseCase({
      load: vi.fn(async () => ({
        source: 'yfinance', symbol: 'AAPL', timeframe: '1d', candles, fetchedAt: 2,
      })),
    }, datasets, analyses, { replace });

    const candidate = await useCase.loadDetached({
      source: 'yfinance', symbol: 'AAPL', timeframe: '1d',
    });

    expect(candidate.symbol).toBe('AAPL');
    expect(candidate.datasetId).not.toBe(activeDataset.datasetId);
    expect(await datasets.getActive()).toBe(activeDataset);
    expect(await analyses.getActive()).toBe(activeAnalysis);
    expect(replace).not.toHaveBeenCalled();
  });
});
