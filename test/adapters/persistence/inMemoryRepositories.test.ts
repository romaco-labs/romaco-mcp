import { describe, expect, it } from 'vitest';
import { InMemoryAnalysisRepository } from '../../../src/adapters/outbound/persistence/InMemoryAnalysisRepository.js';
import { InMemoryDatasetRepository } from '../../../src/adapters/outbound/persistence/InMemoryDatasetRepository.js';
import { createAnalysisId, type AnalysisDraft } from '../../../src/domain/analysis/model.js';
import { createDatasetId, type DatasetDraft } from '../../../src/domain/dataset/model.js';
import type { MarketSummary } from '../../../src/compression/types.js';
import type { TradeThesis } from '../../../src/compression/thesis.js';

const dataset: DatasetDraft = {
  source: 'raw',
  symbol: 'AAPL',
  timeframe: '1d',
  candles: [{ timestamp: 1, open: 10, high: 12, low: 9, close: 11, volume: 100 }],
  fetchedAt: 1000,
};

const summary = { meta: { candles: 1 } } as unknown as MarketSummary;
const thesis = { verdict: 'stand_aside' } as unknown as TradeThesis;

describe('InMemoryDatasetRepository', () => {
  it('assigns an id and activates only explicit records', async () => {
    const repo = new InMemoryDatasetRepository(() => 'one');
    const saved = await repo.save(dataset);

    expect(saved.datasetId).toBe('dataset_one');
    expect(await repo.get(saved.datasetId)).toBe(saved);
    expect(await repo.getActive()).toBeNull();

    await repo.setActive(saved.datasetId);
    expect(await repo.getActive()).toBe(saved);
  });

  it('preserves active record until explicitly replaced or cleared', async () => {
    let n = 0;
    const repo = new InMemoryDatasetRepository(() => String(++n));
    const first = await repo.save(dataset);
    const second = await repo.save({ ...dataset, symbol: 'MSFT' });

    await repo.setActive(first.datasetId);
    expect((await repo.getActive())?.symbol).toBe('AAPL');
    await repo.setActive(second.datasetId);
    expect((await repo.getActive())?.symbol).toBe('MSFT');
    await repo.clearActive();
    expect(await repo.getActive()).toBeNull();
  });

  it('rejects unknown active ids and clears all state', async () => {
    const repo = new InMemoryDatasetRepository(() => 'one');
    const saved = await repo.save(dataset);
    await expect(repo.setActive(createDatasetId('dataset_missing'))).rejects.toThrow(/not found/);

    await repo.setActive(saved.datasetId);
    await repo.clear();
    expect(await repo.get(saved.datasetId)).toBeNull();
    expect(await repo.getActive()).toBeNull();
  });
});

describe('InMemoryAnalysisRepository', () => {
  function draft(datasetId = createDatasetId('dataset_one'), createdAt = 1000): AnalysisDraft {
    return {
      datasetId,
      provider: 'local',
      summary,
      thesis,
      schemaVersion: '1',
      createdAt,
    };
  }

  it('tracks latest and active analyses independently', async () => {
    let n = 0;
    const repo = new InMemoryAnalysisRepository(() => String(++n));
    const first = await repo.save(draft());
    const second = await repo.save(draft(createDatasetId('dataset_one'), 2000));

    expect(first.analysisId).toBe('analysis_1');
    expect((await repo.latestFor(first.datasetId))?.analysisId).toBe(second.analysisId);
    expect(await repo.getActive()).toBeNull();

    await repo.setActive(first.analysisId);
    expect((await repo.getActive())?.analysisId).toBe(first.analysisId);
  });

  it('keeps latest records isolated by dataset', async () => {
    let n = 0;
    const repo = new InMemoryAnalysisRepository(() => String(++n));
    const aapl = await repo.save(draft(createDatasetId('dataset_aapl')));
    const msft = await repo.save(draft(createDatasetId('dataset_msft')));

    expect(await repo.latestFor(aapl.datasetId)).toBe(aapl);
    expect(await repo.latestFor(msft.datasetId)).toBe(msft);
  });

  it('rejects unknown active ids and clears all state', async () => {
    const repo = new InMemoryAnalysisRepository(() => 'one');
    const saved = await repo.save(draft());
    await expect(repo.setActive(createAnalysisId('analysis_missing'))).rejects.toThrow(/not found/);

    await repo.setActive(saved.analysisId);
    await repo.clear();
    expect(await repo.get(saved.analysisId)).toBeNull();
    expect(await repo.latestFor(saved.datasetId)).toBeNull();
    expect(await repo.getActive()).toBeNull();
  });
});
