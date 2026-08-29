import { describe, expect, it, vi } from 'vitest';
import { SetupChartUseCase } from '../../src/application/use-cases/setupChart.js';
import type { ChartJournalPort } from '../../src/application/ports/chartJournal.js';
import type { ChartPresetCatalog } from '../../src/application/ports/chartPresetCatalog.js';
import type { ChartPort } from '../../src/application/ports/chart.js';
import { createChartId } from '../../src/domain/chart/model.js';
import { createDatasetId, type DatasetRecord } from '../../src/domain/dataset/model.js';

const candles = Array.from({ length: 80 }, (_, index) => ({
  timestamp: 1_700_000_000 + index * 3_600,
  open: 100 + index * 0.1,
  high: 101 + index * 0.1,
  low: 99 + index * 0.1,
  close: 100.5 + index * 0.1,
  volume: 1_000 + index,
}));

const dataset: DatasetRecord = {
  datasetId: createDatasetId('dataset_1'),
  source: 'raw',
  symbol: 'AAPL',
  timeframe: '1h',
  candles,
  fetchedAt: 1,
};

const presets: ChartPresetCatalog = {
  names: () => ['institutional'],
  get: () => ({
    name: 'institutional',
    defaultTimeframe: '1h',
    lookback: 80,
    indicators: [
      { type: 'EMA', params: [20] },
      { type: 'RSI', params: [14] },
    ],
  }),
};

function chart(overrides: Partial<ChartPort> = {}): ChartPort {
  return {
    isConnected: () => true,
    getIdentity: vi.fn(async () => ({
      chartId: createChartId('primary'), symbol: 'AAPL', timeframe: '1h',
    })),
    getContext: vi.fn(),
    execute: vi.fn(async () => ({ success: true, resourceIds: ['resource-1'] })),
    replaceDrawingGroup: vi.fn(),
    captureSnapshot: vi.fn(),
    ...overrides,
  };
}

describe('SetupChartUseCase', () => {
  it('skips every live write when symbol differs', async () => {
    const live = chart({
      getIdentity: vi.fn(async () => ({
        chartId: createChartId('primary'), symbol: 'MSFT', timeframe: '1h',
      })),
    });
    const journal: ChartJournalPort = { recordIndicator: vi.fn() };
    const useCase = new SetupChartUseCase(
      { execute: vi.fn(async () => dataset) }, live, presets, journal,
    );

    const result = await useCase.execute({ symbol: 'AAPL', source: 'raw', rawCandles: candles });

    expect(result.liveStatus).toBe('identity_mismatch');
    expect(live.execute).not.toHaveBeenCalled();
    expect(journal.recordIndicator).not.toHaveBeenCalled();
  });

  it('skips every live write when timeframe differs or is unknown', async () => {
    for (const timeframe of ['1d', undefined] as const) {
      const live = chart({
        getIdentity: vi.fn(async () => ({
          chartId: createChartId('primary'), symbol: 'AAPL', timeframe,
        })),
      });
      const useCase = new SetupChartUseCase(
        { execute: vi.fn(async () => dataset) }, live, presets, { recordIndicator: vi.fn() },
      );

      const result = await useCase.execute({ symbol: 'AAPL' });
      expect(result.liveStatus).toBe('identity_mismatch');
      expect(live.execute).not.toHaveBeenCalled();
    }
  });

  it('reports each indicator honestly and journals successes only', async () => {
    const execute = vi.fn()
      .mockResolvedValueOnce({ success: true, resourceIds: ['ema-20'] })
      .mockResolvedValueOnce({ success: false, error: 'host denied RSI' });
    const live = chart({ execute });
    const recordIndicator = vi.fn();
    const useCase = new SetupChartUseCase(
      { execute: vi.fn(async () => dataset) },
      live,
      presets,
      { recordIndicator },
    );

    const result = await useCase.execute({ symbol: 'AAPL' });

    expect(result.liveStatus).toBe('matched');
    expect(result.indicators).toEqual([
      { type: 'EMA', params: [20], success: true, resourceId: 'ema-20' },
      { type: 'RSI', params: [14], success: false, error: 'host denied RSI' },
    ]);
    expect(recordIndicator).toHaveBeenCalledOnce();
    expect(recordIndicator).toHaveBeenCalledWith(
      { type: 'EMA', params: [20] },
      { chartId: 'primary', symbol: 'AAPL', timeframe: '1h' },
      'ema-20',
    );
  });

  it('returns headless analysis without touching chart when disconnected', async () => {
    const live = chart({ isConnected: () => false });
    const useCase = new SetupChartUseCase(
      { execute: vi.fn(async () => dataset) }, live, presets, { recordIndicator: vi.fn() },
    );

    const result = await useCase.execute({ symbol: 'AAPL' });

    expect(result.liveStatus).toBe('disconnected');
    expect(result.summary.meta.candle_count).toBe(80);
    expect(live.getIdentity).not.toHaveBeenCalled();
  });
});
