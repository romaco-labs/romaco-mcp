import { describe, expect, it, vi } from 'vitest';
import { InMemoryAnalysisRepository } from '../../src/adapters/outbound/persistence/InMemoryAnalysisRepository.js';
import { InMemoryDatasetRepository } from '../../src/adapters/outbound/persistence/InMemoryDatasetRepository.js';
import { AnnotateThesisUseCase } from '../../src/application/use-cases/annotateThesis.js';
import { ResolveThesisArtifactUseCase } from '../../src/application/use-cases/resolveThesisArtifact.js';
import type { ChartPort } from '../../src/application/ports/chart.js';
import { analyzeSession } from '../../src/compression/analyze.js';
import { createChartId } from '../../src/domain/chart/model.js';
import { uptrendCandles } from '../compression/fixtures.js';

const candles = uptrendCandles(220, 100, 0.6);
const visibleCandles = [
  { timestamp: 1_700_000_000_000, open: 100, high: 110, low: 90, close: 105, volume: 1_000 },
  { timestamp: 1_700_086_400_000, open: 105, high: 115, low: 95, close: 110, volume: 1_100 },
];

async function fixture(chartOverrides: Partial<ChartPort> = {}) {
  const datasets = new InMemoryDatasetRepository(() => 'dataset');
  const analyses = new InMemoryAnalysisRepository(() => 'analysis');
  const dataset = await datasets.save({
    source: 'raw', symbol: 'TEST', timeframe: '1d', candles, fetchedAt: 1,
  });
  await datasets.setActive(dataset.datasetId);
  const resolver = new ResolveThesisArtifactUseCase(datasets, analyses, { read: () => null });
  const chart: ChartPort = {
    isConnected: () => true,
    getIdentity: vi.fn(),
    getContext: vi.fn(async () => ({
      identity: { chartId: createChartId('primary'), symbol: 'TEST', timeframe: '1d' },
      visibleCandles,
    })),
    execute: vi.fn(async () => ({ success: true })),
    replaceDrawingGroup: vi.fn(async () => ({
      success: true,
      resourceIds: ['drawing-1'],
    })),
    captureSnapshot: vi.fn(),
    ...chartOverrides,
  };
  const replaceDrawingGroup = vi.fn();
  const useCase = new AnnotateThesisUseCase(
    resolver,
    datasets,
    chart,
    { recordIndicator: vi.fn(), replaceDrawingGroup },
  );
  return { dataset, resolver, chart, replaceDrawingGroup, useCase };
}

describe('AnnotateThesisUseCase', () => {
  it('draws exact stored gateway setup with stable atomic idempotency key', async () => {
    const context = await fixture();
    const local = analyzeSession(candles).thesis;
    const gateway = {
      ...local,
      verdict: 'long' as const,
      bias: 'bullish' as const,
      setup: { entry: 200, stop: 190, target: 220, rr: 2, basis: 'gateway exact' },
      notes: ['gateway artifact'],
    };
    const artifact = await context.resolver.storeGatewayThesis(gateway);

    const result = await context.useCase.execute(artifact.analysisId);

    const call = vi.mocked(context.chart.replaceDrawingGroup).mock.calls[0][0];
    const box = call.drawings.find((drawing) => drawing.drawingType === 'longPosition');
    expect(box?.points.map((point) => point.price)).toEqual([200, 190, 220]);
    expect(call.groupId).toBe('romaco-mcp/thesis');
    expect(call.idempotencyKey).toBe(
      `${artifact.analysisId}:primary:${visibleCandles[0].timestamp}:${visibleCandles[1].timestamp}:thesis-v1`,
    );
    expect(result.artifact).toBe(artifact);
    expect(context.replaceDrawingGroup).toHaveBeenCalledOnce();
  });

  it('fails before replacement on symbol or timeframe mismatch', async () => {
    const context = await fixture({
      getContext: vi.fn(async () => ({
        identity: { chartId: createChartId('primary'), symbol: 'MSFT', timeframe: '1h' },
        visibleCandles,
      })),
    });

    await expect(context.useCase.execute()).rejects.toThrow(/chart shows/i);
    expect(context.chart.replaceDrawingGroup).not.toHaveBeenCalled();
    expect(context.replaceDrawingGroup).not.toHaveBeenCalled();
  });

  it('journals nothing when atomic replacement fails', async () => {
    const context = await fixture({
      replaceDrawingGroup: vi.fn(async () => { throw new Error('host denied'); }),
    });

    await expect(context.useCase.execute()).rejects.toThrow(/host denied/i);
    expect(context.replaceDrawingGroup).not.toHaveBeenCalled();
  });

  it('keeps same-view retries stable and changes key when viewport anchors change', async () => {
    const getContext = vi.fn()
      .mockResolvedValueOnce({
        identity: { chartId: createChartId('primary'), symbol: 'TEST', timeframe: '1d' },
        visibleCandles,
      })
      .mockResolvedValueOnce({
        identity: { chartId: createChartId('primary'), symbol: 'TEST', timeframe: '1d' },
        visibleCandles,
      })
      .mockResolvedValueOnce({
        identity: { chartId: createChartId('primary'), symbol: 'TEST', timeframe: '1d' },
        visibleCandles: visibleCandles.map((candle) => ({
          ...candle,
          timestamp: candle.timestamp + 86_400_000,
        })),
      });
    const context = await fixture({ getContext });

    const first = await context.useCase.execute();
    const same = await context.useCase.execute(first.artifact.analysisId);
    const moved = await context.useCase.execute(first.artifact.analysisId);

    expect(same.idempotencyKey).toBe(first.idempotencyKey);
    expect(moved.idempotencyKey).not.toBe(first.idempotencyKey);
  });
});
