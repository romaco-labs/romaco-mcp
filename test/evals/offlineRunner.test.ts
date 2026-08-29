import { describe, expect, it } from 'vitest';
import { OfflineEvalRunner } from '../../evals/harness/offline-runner.mjs';
import {
  FakeAnalysisGatewayPort,
  FakeChartPort,
  FixtureMarketDataPort,
  MemoryTelemetrySink,
} from '../../evals/harness/fake-ports.mjs';

describe('offline eval harness foundation', () => {
  it('reports planned work without inventing a task success rate', async () => {
    const report = await new OfflineEvalRunner().run();
    expect(report).toMatchObject({
      manifestValid: true,
      selectedTasks: 28,
      executed: 0,
      planned: 28,
      taskSuccessRate: null,
    });
    expect(report.results.every((result) => result.status === 'planned')).toBe(true);
  });

  it('can require full runnable coverage and fail honestly', async () => {
    await expect(new OfflineEvalRunner().run({ requireAll: true })).rejects.toThrow(
      /28 eval task\(s\) are still planned/,
    );
  });

  it('provides deterministic fakes matching current outbound port shapes', async () => {
    const marketData = new FixtureMarketDataPort(new Map([
      ['yfinance:AAPL:1d', {
        source: 'yfinance',
        symbol: 'AAPL',
        timeframe: '1d',
        candles: [{ timestamp: 1, open: 1, high: 2, low: 1, close: 2, volume: 3 }],
        fetchedAt: 0,
      }],
    ]));
    const dataset = await marketData.load({ source: 'yfinance', symbol: 'AAPL', timeframe: '1d' });
    expect(dataset.symbol).toBe('AAPL');
    expect(marketData.calls).toHaveLength(1);

    const gateway = new FakeAnalysisGatewayPort({ enabled: true, response: { provider: 'local' } });
    expect(gateway.enabled()).toBe(true);
    expect(await gateway.analyze({ datasetId: 'ds_1' })).toEqual({ provider: 'local' });

    const telemetry = new MemoryTelemetrySink();
    telemetry.record({ event: 'test' });
    expect(telemetry.events).toEqual([{ event: 'test' }]);
  });

  it('atomically replaces owned drawing groups and preserves user drawings', async () => {
    const chart = new FakeChartPort({
      identity: { chartId: 'chart_1', symbol: 'AAPL', timeframe: '1d', datasetId: 'ds_1' },
      drawings: [
        { id: 'user_1', owner: 'user', groupId: null, type: 'trendline' },
        { id: 'old_1', owner: 'romaco', groupId: 'romaco-thesis', type: 'horizontalLine' },
      ],
    });
    const command = {
      groupId: 'romaco-thesis',
      expectedIdentity: { chartId: 'chart_1', symbol: 'AAPL', timeframe: '1d', datasetId: 'ds_1' },
      idempotencyKey: 'idem_1',
      drawings: [{
        action: 'addDrawing',
        drawingType: 'horizontalLine',
        points: [{ timestamp: 1, price: 100 }],
        groupId: 'romaco-thesis',
      }],
    };

    const first = await chart.replaceDrawingGroup(command);
    const retry = await chart.replaceDrawingGroup(command);
    expect(first).toEqual(retry);
    expect(chart.state().drawings).toEqual([
      expect.objectContaining({ id: 'user_1', owner: 'user' }),
      expect.objectContaining({ owner: 'romaco', groupId: 'romaco-thesis' }),
    ]);
  });
});
