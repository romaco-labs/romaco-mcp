import { describe, expect, it } from 'vitest';
import { FakeChartPort, FixtureMarketDataPort } from '../../../evals/harness/fake-ports.mjs';
import { createEvalMcpHarness, createEvalRuntime } from '../../../evals/harness/runtime.mjs';

function candles(base: number) {
  return Array.from({ length: 100 }, (_, index) => ({
    timestamp: 1_700_000_000 + index * 3_600,
    open: base + index / 10,
    high: base + 1 + index / 10,
    low: base - 1 + index / 10,
    close: base + 0.5 + index / 10,
    volume: 1_000 + index,
  }));
}

describe('romaco_setup_chart exact dataset correlation', () => {
  it('never pairs an earlier setup with a later concurrent active analysis', async () => {
    const aapl = candles(100);
    const tsla = candles(200);
    const chart = new FakeChartPort({
      identity: { chartId: 'chart_aapl', symbol: 'AAPL', timeframe: '1d' },
      connected: true,
      visibleCandles: aapl,
    });
    let releaseIndicator!: () => void;
    let signalIndicator!: () => void;
    const indicatorBlocked = new Promise<void>((resolve) => { signalIndicator = resolve; });
    const indicatorRelease = new Promise<void>((resolve) => { releaseIndicator = resolve; });
    const execute = chart.execute.bind(chart);
    chart.execute = async (...args: Parameters<typeof execute>) => {
      signalIndicator();
      await indicatorRelease;
      return execute(...args);
    };

    const built = createEvalRuntime({ marketData: new FixtureMarketDataPort(), chart });
    const harness = await createEvalMcpHarness({ runtime: built.runtime });
    try {
      const aaplSetupPromise = harness.callTool('romaco_setup_chart', {
        symbol: 'AAPL', preset: 'institutional', timeframe: '1d', source: 'raw', rawCandles: aapl,
      });
      await indicatorBlocked;
      const tslaSetup = await harness.callTool('romaco_setup_chart', {
        symbol: 'TSLA', preset: 'clean', timeframe: '1d', source: 'raw', rawCandles: tsla,
      });
      releaseIndicator();
      const aaplSetup = await aaplSetupPromise;

      const aaplResult = aaplSetup.structuredContent as any;
      const tslaResult = tslaSetup.structuredContent as any;
      expect(aaplResult.data.dataset.symbol).toBe('AAPL');
      expect(aaplResult.data.analysis.meta.last_price).toBe(aapl.at(-1)!.close);
      expect(aaplResult.context.datasetId).toBe(aaplResult.data.dataset.datasetId);
      expect(aaplResult.context.analysisId).toBe(aaplResult.data.analysisId);
      expect(aaplResult.data.analysisId).not.toBe(tslaResult.data.analysisId);
      expect((await built.runtime.analyses.get(aaplResult.data.analysisId))?.datasetId)
        .toBe(aaplResult.data.dataset.datasetId);
    } finally {
      releaseIndicator();
      await harness.close();
    }
  });
});
