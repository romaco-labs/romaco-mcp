import { describe, expect, it } from 'vitest';
import { OfflineEvalRunner } from '../../evals/harness/offline-runner.mjs';
import { DETERMINISTIC_GRADERS } from '../../evals/graders/deterministic.mjs';
import { SUPPORTED_OFFLINE_TRIALS } from '../../evals/trials/supported.mjs';
import {
  FakeAnalysisGatewayPort,
  FakeChartPort,
  FixtureMarketDataPort,
  MemoryTelemetrySink,
} from '../../evals/harness/fake-ports.mjs';

describe('offline eval harness foundation', () => {
  it('fails closed when a runnable workflow or grader implementation disappears', async () => {
    await expect(new OfflineEvalRunner().run()).rejects.toMatchObject({
      report: {
        manifestValid: true,
        selectedTasks: 28,
        executed: 0,
        failed: 0,
        harnessErrors: 17,
        planned: 11,
        taskSuccessRate: null,
      },
    });
  });

  it('can require full runnable coverage and fail honestly', async () => {
    await expect(new OfflineEvalRunner({
      trials: SUPPORTED_OFFLINE_TRIALS,
      graders: DETERMINISTIC_GRADERS,
    }).run({ requireAll: true })).rejects.toThrow(
      /0 runnable eval task\(s\) failed; 0 harness error\(s\); 11 task\(s\) remain planned/,
    );
  });

  it('fails the run when any executed runnable grader fails', async () => {
    const graders = new Map(DETERMINISTIC_GRADERS);
    graders.set('budget', () => ({ passed: false, message: 'forced failure' }));
    await expect(new OfflineEvalRunner({
      trials: SUPPORTED_OFFLINE_TRIALS,
      graders,
    }).run()).rejects.toMatchObject({
      report: {
        executed: 17, passed: 0, failed: 17, harnessErrors: 0, planned: 11, taskSuccessRate: 0,
      },
    });
  });

  it('executes and grades only honestly runnable tasks', async () => {
    const report = await new OfflineEvalRunner({
      trials: SUPPORTED_OFFLINE_TRIALS,
      graders: DETERMINISTIC_GRADERS,
    }).run();
    expect(report).toMatchObject({
      selectedTasks: 28,
      executed: 17,
      passed: 17,
      failed: 0,
      planned: 11,
      taskSuccessRate: 1,
    });
    expect(report.results.filter((result) => result.status === 'passed')).toHaveLength(17);
    expect(report.results.filter((result) => result.status === 'planned')).toHaveLength(11);
    expect(report.plannedBlockers).toHaveLength(11);
    expect(report.plannedBlockers.every((blocker) => blocker.reason.length >= 30)).toBe(true);
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
