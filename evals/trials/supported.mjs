import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { FakeChartPort, FixtureMarketDataPort } from '../harness/fake-ports.mjs';
import { createEvalMcpHarness, createEvalRuntime } from '../harness/runtime.mjs';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

function realCandles(symbol) {
  return JSON.parse(readFileSync(path.join(REPO_ROOT, `test/fixtures/real/${symbol}_1d_400.json`), 'utf8'));
}

function flatCandles(count = 120) {
  return Array.from({ length: count }, (_, index) => {
    const close = 100 + (index % 2 === 0 ? 0.01 : -0.01);
    return {
      timestamp: 1_700_000_000 + index * 3_600,
      open: 100,
      high: 100.05,
      low: 99.95,
      close,
      volume: 1_000,
    };
  });
}

function disconnectedChart(symbol = 'AAPL', timeframe = '1d') {
  return new FakeChartPort({
    identity: { chartId: `chart_${symbol.toLowerCase()}`, symbol, timeframe },
    connected: false,
  });
}

function connectedChart(symbol, timeframe, candles, extra = {}) {
  return new FakeChartPort({
    identity: { chartId: `chart_${symbol.toLowerCase()}`, symbol, timeframe },
    connected: true,
    visibleCandles: candles,
    rawContext: {
      symbol,
      resolution: timeframe,
      currentPrice: candles.at(-1)?.close ?? null,
      totalCandles: candles.length,
      visibleRange: {
        startIndex: 0,
        endIndex: Math.max(0, candles.length - 1),
        startTimestamp: candles[0]?.timestamp,
        endTimestamp: candles.at(-1)?.timestamp,
      },
      renderBackend: 'canvas2d',
      panels: [],
    },
    ...extra,
  });
}

function structured(result) {
  return result.structuredContent;
}

async function runWithHarness({ chart, execute }) {
  const marketData = new FixtureMarketDataPort();
  const built = createEvalRuntime({ marketData, chart });
  const harness = await createEvalMcpHarness({ runtime: built.runtime });
  try {
    const facts = await execute({ harness, chart, ...built });
    return {
      calls: harness.calls,
      telemetry: harness.telemetry.events,
      chartState: chart.state(),
      journal: {
        indicators: structuredClone(built.journal.indicators),
        groups: Object.fromEntries(built.journal.groups),
      },
      claims: facts.claims ?? [],
      facts,
    };
  } finally {
    await harness.close();
  }
}

async function h01() {
  const candles = realCandles('AAPL');
  return runWithHarness({
    chart: disconnectedChart(),
    execute: async ({ harness }) => {
      const setup = await harness.callTool('romaco_setup_chart', {
        symbol: 'AAPL', preset: 'clean', timeframe: '1d', source: 'raw', rawCandles: candles,
      });
      const data = structured(setup).data;
      return {
        setup,
        expectedSymbol: 'AAPL',
        expectedCandleCount: candles.length,
        claims: [
          data.analysis.meta.last_price,
          ...(data.analysis.levels.support.slice(0, 1)),
        ],
      };
    },
  });
}

async function h02() {
  const candles = realCandles('SPY');
  return runWithHarness({
    chart: disconnectedChart('SPY'),
    execute: async ({ harness }) => {
      const setup = await harness.callTool('romaco_setup_chart', {
        symbol: 'SPY', preset: 'institutional', timeframe: '1d', source: 'raw', rawCandles: candles,
      });
      return { setup, expectedSymbol: 'SPY', expectedLiveStatus: 'disconnected' };
    },
  });
}

async function h03() {
  const candles = flatCandles();
  return runWithHarness({
    chart: disconnectedChart('RECOVER', '1h'),
    execute: async ({ harness }) => {
      const first = await harness.callTool('romaco_thesis');
      const setup = await harness.callTool('romaco_setup_chart', {
        symbol: 'RECOVER', preset: 'clean', timeframe: '1h', source: 'raw', rawCandles: candles,
      });
      const recovered = await harness.callTool('romaco_thesis');
      return { first, setup, recovered, expectedErrorCode: 'SESSION_NOT_LOADED' };
    },
  });
}

async function h05() {
  const candles = flatCandles();
  return runWithHarness({
    chart: disconnectedChart('FLAT', '1h'),
    execute: async ({ harness }) => {
      const setup = await harness.callTool('romaco_setup_chart', {
        symbol: 'FLAT', preset: 'clean', timeframe: '1h', source: 'raw', rawCandles: candles,
      });
      const thesis = await harness.callTool('romaco_thesis');
      return { setup, thesis, expectedVerdict: 'stand_aside', claims: [] };
    },
  });
}

async function h08() {
  return runWithHarness({
    chart: disconnectedChart(),
    execute: async ({ harness }) => {
      const invalid = await harness.callTool('romaco_calculate_position_size', {
        accountSize: 10_000,
        riskPct: 1,
        entryPrice: 100,
        stopLoss: 98,
        targetPrice: 99,
        commissionPerSide: 1,
      });
      const corrected = await harness.callTool('romaco_calculate_position_size', {
        accountSize: 10_000,
        riskPct: 1,
        entryPrice: 100,
        stopLoss: 98,
        targetPrice: 106,
        commissionPerSide: 1,
      });
      return { invalid, corrected, expectedErrorCode: 'INVALID_ARGUMENT' };
    },
  });
}

async function l01() {
  const candles = realCandles('AAPL');
  return runWithHarness({
    chart: connectedChart('AAPL', '1d', candles),
    execute: async ({ harness }) => {
      const setup = await harness.callTool('romaco_setup_chart', {
        symbol: 'AAPL', preset: 'institutional', timeframe: '1d', source: 'raw', rawCandles: candles,
      });
      return { setup, expectedLiveStatus: 'matched', expectedResourceCount: 2 };
    },
  });
}

async function l02() {
  const candles = realCandles('AAPL').slice(-120);
  return runWithHarness({
    chart: connectedChart('AAPL', '1d', candles),
    execute: async ({ harness }) => {
      const context = await harness.callTool('romaco_get_chart_context');
      const deniedRaw = await harness.callTool('romaco_get_chart_context', {
        acknowledgeHighTokenCost: true,
      });
      return {
        context,
        deniedRaw,
        expectedChartId: 'chart_aapl',
        expectedCandleCount: candles.length,
        expectedErrorCode: 'ACTION_DENIED',
      };
    },
  });
}

async function l05() {
  const candles = realCandles('AAPL');
  const userDrawing = { id: 'user_1', owner: 'user', groupId: null, type: 'trendline' };
  return runWithHarness({
    chart: connectedChart('AAPL', '1d', candles, { drawings: [userDrawing] }),
    execute: async ({ harness }) => {
      const setup = await harness.callTool('romaco_setup_chart', {
        symbol: 'AAPL', preset: 'clean', timeframe: '1d', source: 'raw', rawCandles: candles,
      });
      const analysisId = structured(setup).data.analysisId;
      const first = await harness.callTool('romaco_annotate', { analysisId });
      const retry = await harness.callTool('romaco_annotate', { analysisId });
      return { setup, first, retry, analysisId, userDrawingId: 'user_1' };
    },
  });
}

async function l06() {
  const candles = realCandles('AAPL');
  return runWithHarness({
    chart: connectedChart('TSLA', '1d', realCandles('TSLA')),
    execute: async ({ harness, chart }) => {
      const setup = await harness.callTool('romaco_setup_chart', {
        symbol: 'AAPL', preset: 'clean', timeframe: '1d', source: 'raw', rawCandles: candles,
      });
      const analysisId = structured(setup).data.analysisId;
      const beforeWrites = chart.calls.filter((call) => call.operation === 'replaceDrawingGroup').length;
      const annotate = await harness.callTool('romaco_annotate', { analysisId });
      const afterWrites = chart.calls.filter((call) => call.operation === 'replaceDrawingGroup').length;
      return {
        setup,
        annotate,
        expectedErrorCode: 'CHART_CONTEXT_MISMATCH',
        writeDelta: afterWrites - beforeWrites,
      };
    },
  });
}

export const SUPPORTED_OFFLINE_TRIALS = new Map([
  ['raw-load-analyze', h01],
  ['headless-setup', h02],
  ['missing-session-recovery', h03],
  ['flat-stand-aside', h05],
  ['invalid-target-recovery', h08],
  ['live-setup-identity', l01],
  ['context-cost-gate', l02],
  ['annotate-atomic-idempotent', l05],
  ['cross-symbol-hard-stop', l06],
]);
