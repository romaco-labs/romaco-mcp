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

function headShouldersCandles() {
  const prices = [
    100, 102, 105, 110, 115, 113, 110, 107, 105,
    100, 95, 100, 105, 110, 115, 120, 125, 128, 130,
    125, 120, 115, 110, 105,
    108, 112, 115, 113, 110, 107, 105, 100, 95, 90,
  ];
  return prices.map((price, index) => ({
    timestamp: 1_700_000_000 + index * 3_600,
    open: price,
    high: price + 0.5,
    low: price - 0.5,
    close: price,
    volume: 1_000,
  }));
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

function approvalParameters(challenge) {
  const envelope = structured(challenge);
  if (envelope?.error?.code !== 'APPROVAL_REQUIRED') {
    throw new Error(`Expected APPROVAL_REQUIRED, got ${envelope?.error?.code ?? 'no error'}.`);
  }
  return envelope.error.recovery.parameters;
}

async function approvedAnnotate(harness, analysisId) {
  const challenge = await harness.callTool('romaco_annotate', { analysisId });
  const parameters = approvalParameters(challenge);
  const applied = await harness.callTool('romaco_annotate', {
    analysisId: parameters.analysisId,
    approvalToken: parameters.approvalToken,
  });
  return { challenge, applied, parameters };
}

async function runWithHarness({ chart, execute, marketFixtures = new Map() }) {
  const marketData = new FixtureMarketDataPort(marketFixtures);
  const built = createEvalRuntime({ marketData, chart });
  const harness = await createEvalMcpHarness({ runtime: built.runtime });
  try {
    const facts = await execute({ harness, chart, ...built });
    return {
      calls: harness.calls,
      telemetry: harness.telemetry.events,
      chartState: chart.state(),
      chartCalls: structuredClone(chart.calls),
      journal: {
        indicators: structuredClone(built.journal.indicators),
        drawings: structuredClone(built.journal.drawings),
        alerts: structuredClone(built.journal.alerts),
        groups: Object.fromEntries(built.journal.groups),
      },
      evidenceNumbers: facts.evidenceNumbers ?? [],
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
        evidenceNumbers: [
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

async function h04() {
  const candles = headShouldersCandles();
  return runWithHarness({
    chart: disconnectedChart('AAPL', '1h'),
    execute: async ({ harness }) => {
      const setup = await harness.callTool('romaco_setup_chart', {
        symbol: 'AAPL', preset: 'clean', timeframe: '1h', source: 'raw', rawCandles: candles,
      });
      const concise = await harness.callTool('romaco_detect_patterns');
      const full = await harness.callTool('romaco_detect_patterns', {
        acknowledgeHighTokenCost: true,
      });
      return { setup, concise, full };
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
      return { setup, thesis, expectedVerdict: 'stand_aside' };
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

async function h09() {
  const aapl = realCandles('AAPL');
  const spy = realCandles('SPY');
  const marketFixtures = new Map([
    ['yfinance:AAPL:1d', {
      source: 'yfinance', symbol: 'AAPL', timeframe: '1d', candles: aapl, fetchedAt: 1,
    }],
    ['yfinance:SPY:1d', {
      source: 'yfinance', symbol: 'SPY', timeframe: '1d', candles: spy, fetchedAt: 2,
    }],
    ['yfinance:MISSING:1d', { error: new Error('fixture market data unavailable') }],
  ]);
  return runWithHarness({
    chart: disconnectedChart(),
    marketFixtures,
    execute: async ({ harness, runtime, projection }) => {
      const batch = await harness.callTool('romaco_thesis_batch', {
        symbols: ['AAPL', 'SPY', 'MISSING'],
        timeframe: '1d',
        lookback: 300,
      });
      const activeDataset = await runtime.datasets.getActive();
      const activeAnalysis = await runtime.analyses.getActive();
      return {
        batch,
        activeDatasetId: activeDataset?.datasetId,
        activeAnalysisId: activeAnalysis?.analysisId,
        projectedDatasetId: projection.active?.datasetId,
      };
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

async function l03() {
  const candles = realCandles('AAPL').slice(-120);
  return runWithHarness({
    chart: connectedChart('AAPL', '1d', candles),
    execute: async ({ harness }) => {
      const added = await harness.callTool('romaco_add_indicator', {
        indicatorType: 'RSI',
        params: [14],
      });
      const indicatorId = structured(added).data.indicator.indicatorId;
      const values = await harness.callTool('romaco_get_indicator_values', { indicatorId });
      return { added, values, indicatorId };
    },
  });
}

async function l04() {
  const candles = realCandles('AAPL').slice(-120);
  const first = candles[0];
  const last = candles.at(-1);
  return runWithHarness({
    chart: connectedChart('AAPL', '1d', candles),
    execute: async ({ harness, chart }) => {
      const invalid = await harness.callTool('romaco_add_drawing', {
        drawingType: 'fibRetracement',
        points: [{ timestamp: first.timestamp * 1_000, price: first.low }],
      });
      const writesAfterInvalid = chart.calls.filter(
        (call) => call.operation === 'execute' && call.command.action === 'addDrawing',
      ).length;
      const valid = await harness.callTool('romaco_add_drawing', {
        drawingType: 'fibRetracement',
        points: [
          { timestamp: first.timestamp * 1_000, price: first.low },
          { timestamp: last.timestamp * 1_000, price: last.high },
        ],
      });
      const writesAfterValid = chart.calls.filter(
        (call) => call.operation === 'execute' && call.command.action === 'addDrawing',
      ).length;
      return { invalid, valid, writesAfterInvalid, writesAfterValid };
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
      const firstApproval = await approvedAnnotate(harness, analysisId);
      const retryApproval = await approvedAnnotate(harness, analysisId);
      return {
        setup,
        firstChallenge: firstApproval.challenge,
        first: firstApproval.applied,
        retryChallenge: retryApproval.challenge,
        retry: retryApproval.applied,
        analysisId,
        userDrawingId: 'user_1',
      };
    },
  });
}

async function s04() {
  const candles = realCandles('AAPL');
  const userDrawing = { id: 'user_1', owner: 'user', groupId: null, type: 'trendline' };
  return runWithHarness({
    chart: connectedChart('AAPL', '1d', candles, { drawings: [userDrawing] }),
    execute: async ({ harness }) => {
      const setup = await harness.callTool('romaco_setup_chart', {
        symbol: 'AAPL', preset: 'clean', timeframe: '1d', source: 'raw', rawCandles: candles,
      });
      const analysisId = structured(setup).data.analysisId;
      const approval = await approvedAnnotate(harness, analysisId);
      return {
        setup,
        challenge: approval.challenge,
        retry: approval.applied,
        analysisId,
        userDrawingId: 'user_1',
      };
    },
  });
}

async function s01() {
  const aapl = realCandles('AAPL').slice(-120);
  const tsla = realCandles('TSLA').slice(-120);
  return runWithHarness({
    chart: connectedChart('AAPL', '1d', aapl),
    execute: async ({ harness, chart, runtime, journal }) => {
      const drawing = await harness.callTool('romaco_add_drawing', {
        drawingType: 'trendline',
        points: [
          { timestamp: aapl.at(-20).timestamp * 1_000, price: aapl.at(-20).low },
          { timestamp: aapl.at(-1).timestamp * 1_000, price: aapl.at(-1).high },
        ],
        groupId: 'romaco-mcp/eval-aapl',
      });
      const alert = await harness.callTool('romaco_add_alert', {
        price: aapl.at(-1).close,
        direction: 'above',
      });
      const desiredBefore = journal.snapshot();
      chart.identity = { chartId: 'chart_tsla', symbol: 'TSLA', timeframe: '1d' };
      chart.visibleCandles = structuredClone(tsla);
      chart.drawings = [];
      chart.indicators = [];
      chart.alerts = [];
      const writesBeforeReconnect = chart.calls.filter(
        (call) => call.operation === 'execute' || call.operation === 'replaceDrawingGroup',
      ).length;
      const reconcile = await runtime.reconcileChart.execute({ attempts: 1, delayMs: 0 });
      const writesAfterReconnect = chart.calls.filter(
        (call) => call.operation === 'execute' || call.operation === 'replaceDrawingGroup',
      ).length;
      return {
        drawing,
        alert,
        desiredBefore,
        desiredAfter: journal.snapshot(),
        reconcile,
        writesBeforeReconnect,
        writesAfterReconnect,
      };
    },
  });
}

async function s02() {
  const candles = realCandles('AAPL').slice(-120);
  return runWithHarness({
    chart: connectedChart('AAPL', '1d', candles),
    execute: async ({ harness, chart, runtime, journal }) => {
      const added = await harness.callTool('romaco_add_indicator', {
        indicatorType: 'RSI', params: [14],
      });
      const originalId = structured(added).data.indicator.indicatorId;
      chart.indicators = [];
      const writesBeforeRefresh = chart.calls.filter((call) => call.operation === 'execute').length;
      const refreshed = await runtime.reconcileChart.execute({ attempts: 1, delayMs: 0 });
      const writesAfterRefresh = chart.calls.filter((call) => call.operation === 'execute').length;
      const desiredAfterRefresh = journal.snapshot();
      const refreshedId = desiredAfterRefresh.indicators[0]?.resourceIds?.[0];
      const removed = await harness.callTool('romaco_remove_indicator', { indicatorId: refreshedId });
      const writesAfterRemove = chart.calls.filter((call) => call.operation === 'execute').length;
      const finalReconnect = await runtime.reconcileChart.execute({ attempts: 1, delayMs: 0 });
      const writesAfterFinalReconnect = chart.calls.filter((call) => call.operation === 'execute').length;
      return {
        added,
        removed,
        originalId,
        refreshedId,
        refreshed,
        desiredAfterRefresh,
        finalReconnect,
        finalDesired: journal.snapshot(),
        writesBeforeRefresh,
        writesAfterRefresh,
        writesAfterRemove,
        writesAfterFinalReconnect,
      };
    },
  });
}

async function s03() {
  const candles = realCandles('AAPL').slice(-120);
  const price = candles.at(-1).close;
  return runWithHarness({
    chart: connectedChart('AAPL', '1d', candles),
    execute: async ({ harness, chart, runtime, journal }) => {
      const added = await harness.callTool('romaco_add_alert', { price, direction: 'above' });
      const originalId = structured(added).data.alert.alertId;
      chart.alerts = [];
      const writesBeforeRefresh = chart.calls.filter((call) => call.operation === 'execute').length;
      const refreshed = await runtime.reconcileChart.execute({ attempts: 1, delayMs: 0 });
      const writesAfterRefresh = chart.calls.filter((call) => call.operation === 'execute').length;
      const desiredAfterRefresh = journal.snapshot();
      const refreshedId = desiredAfterRefresh.alerts[0]?.resourceIds?.[0];
      const removed = await harness.callTool('romaco_remove_alert', { alertId: refreshedId });
      const writesAfterRemove = chart.calls.filter((call) => call.operation === 'execute').length;
      const finalReconnect = await runtime.reconcileChart.execute({ attempts: 1, delayMs: 0 });
      const writesAfterFinalReconnect = chart.calls.filter((call) => call.operation === 'execute').length;
      return {
        added,
        removed,
        originalId,
        refreshedId,
        refreshed,
        desiredAfterRefresh,
        finalReconnect,
        finalDesired: journal.snapshot(),
        writesBeforeRefresh,
        writesAfterRefresh,
        writesAfterRemove,
        writesAfterFinalReconnect,
      };
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
      const challenge = await harness.callTool('romaco_annotate', { analysisId });
      const afterChallenge = chart.calls.filter((call) => call.operation === 'replaceDrawingGroup').length;
      const parameters = approvalParameters(challenge);
      const annotate = await harness.callTool('romaco_annotate', {
        analysisId: parameters.analysisId,
        approvalToken: parameters.approvalToken,
      });
      const afterWrites = chart.calls.filter((call) => call.operation === 'replaceDrawingGroup').length;
      return {
        setup,
        challenge,
        annotate,
        expectedErrorCode: 'CHART_CONTEXT_MISMATCH',
        writeDelta: afterWrites - beforeWrites,
        challengeWriteDelta: afterChallenge - beforeWrites,
      };
    },
  });
}

async function l07() {
  const candles = headShouldersCandles();
  const userDrawing = { id: 'user_1', owner: 'user', groupId: null, type: 'trendline' };
  return runWithHarness({
    chart: connectedChart('AAPL', '1h', candles, { drawings: [userDrawing] }),
    execute: async ({ harness }) => {
      const setup = await harness.callTool('romaco_setup_chart', {
        symbol: 'AAPL', preset: 'clean', timeframe: '1h', source: 'raw', rawCandles: candles,
      });
      const first = await harness.callTool('romaco_draw_pattern', { kind: 'head_shoulders' });
      const second = await harness.callTool('romaco_draw_pattern', { kind: 'head_shoulders' });
      return {
        setup,
        first,
        second,
        expectedGroupId: 'romaco-mcp/pattern/hs',
        userDrawingId: userDrawing.id,
      };
    },
  });
}

async function l08() {
  const candles = realCandles('AAPL').slice(-120);
  return runWithHarness({
    chart: connectedChart('AAPL', '1d', candles),
    execute: async ({ harness, chart }) => {
      const beforeCaptures = chart.calls.filter((call) => call.operation === 'captureSnapshot').length;
      const gated = await harness.callTool('romaco_capture_snapshot', { format: 'jpeg' });
      const afterGate = chart.calls.filter((call) => call.operation === 'captureSnapshot').length;
      const captured = await harness.callTool('romaco_capture_snapshot', {
        format: 'jpeg',
        acknowledgeHighTokenCost: true,
      });
      const afterCapture = chart.calls.filter((call) => call.operation === 'captureSnapshot').length;
      return { gated, captured, beforeCaptures, afterGate, afterCapture };
    },
  });
}

async function a01() {
  const candles = realCandles('AAPL');
  return runWithHarness({
    chart: connectedChart('AAPL', '1d', candles),
    execute: async ({ harness, chart }) => {
      const setup = await harness.callTool('romaco_setup_chart', {
        symbol: 'AAPL', preset: 'clean', timeframe: '1d', source: 'raw', rawCandles: candles,
      });
      const analysisId = structured(setup).data.analysisId;
      const beforeWrites = chart.calls.filter((call) => call.operation === 'replaceDrawingGroup').length;
      const challenge = await harness.callTool('romaco_annotate', { analysisId });
      const parameters = approvalParameters(challenge);
      const afterChallenge = chart.calls.filter((call) => call.operation === 'replaceDrawingGroup').length;
      const approved = await harness.callTool('romaco_annotate', {
        analysisId: parameters.analysisId,
        approvalToken: parameters.approvalToken,
      });
      const afterApproved = chart.calls.filter((call) => call.operation === 'replaceDrawingGroup').length;
      const replay = await harness.callTool('romaco_annotate', {
        analysisId: parameters.analysisId,
        approvalToken: parameters.approvalToken,
      });
      const afterReplay = chart.calls.filter((call) => call.operation === 'replaceDrawingGroup').length;
      return {
        setup,
        challenge,
        approved,
        replay,
        beforeWrites,
        afterChallenge,
        afterApproved,
        afterReplay,
      };
    },
  });
}

async function a02() {
  const candles = realCandles('AAPL').slice(-120);
  const identity = { chartId: 'chart_aapl', symbol: 'AAPL', timeframe: '1d' };
  const groupId = 'romaco-mcp/thesis';
  const userDrawing = { id: 'user_1', owner: 'user', groupId: null, type: 'trendline' };
  const agentDrawings = [
    { id: 'agent_1', owner: 'romaco', groupId, type: 'horizontalLine' },
    { id: 'agent_2', owner: 'romaco', groupId, type: 'rectangle' },
  ];
  return runWithHarness({
    chart: connectedChart('AAPL', '1d', candles, { drawings: [userDrawing, ...agentDrawings] }),
    execute: async ({ harness, chart, journal }) => {
      journal.replaceDrawingGroup(groupId, [
        {
          action: 'addDrawing', drawingType: 'horizontalLine',
          points: [{ timestamp: candles.at(-1).timestamp, price: candles.at(-1).close }], groupId,
        },
        {
          action: 'addDrawing', drawingType: 'rectangle',
          points: [
            { timestamp: candles.at(-20).timestamp, price: candles.at(-20).low },
            { timestamp: candles.at(-1).timestamp, price: candles.at(-1).high },
          ], groupId,
        },
      ], identity, 'fixture-clear-plan', ['agent_1', 'agent_2']);
      const beforeWrites = chart.calls.filter((call) => call.operation === 'replaceDrawingGroup').length;
      const preview = await harness.callTool('romaco_clear_drawings');
      const afterPreview = chart.calls.filter((call) => call.operation === 'replaceDrawingGroup').length;
      const parameters = approvalParameters(preview);
      const applied = await harness.callTool('romaco_clear_drawings', {
        planId: parameters.planId,
        approvalToken: parameters.approvalToken,
      });
      const afterApply = chart.calls.filter((call) => call.operation === 'replaceDrawingGroup').length;
      const replay = await harness.callTool('romaco_clear_drawings', {
        planId: parameters.planId,
        approvalToken: parameters.approvalToken,
      });
      const afterReplay = chart.calls.filter((call) => call.operation === 'replaceDrawingGroup').length;
      return {
        preview,
        applied,
        replay,
        beforeWrites,
        afterPreview,
        afterApply,
        afterReplay,
        groupId,
        userDrawingId: userDrawing.id,
        expectedRemovedCount: agentDrawings.length,
      };
    },
  });
}

async function a03() {
  const candles = realCandles('AAPL').slice(-120);
  return runWithHarness({
    chart: connectedChart('AAPL', '1d', candles),
    execute: async ({ harness, chart }) => {
      const input = {
        side: 'long', quantity: 2, stopLoss: 95, takeProfit: 110,
        idempotencyKey: 'eval-paper-aapl-1',
      };
      const beforeWrites = chart.paperPositions.length;
      const challenge = await harness.callTool('romaco_open_paper_position', input);
      const afterChallenge = chart.paperPositions.length;
      const parameters = approvalParameters(challenge);
      const opened = await harness.callTool('romaco_open_paper_position', {
        ...input,
        approvalToken: parameters.approvalToken,
      });
      const afterOpened = chart.paperPositions.length;
      const replay = await harness.callTool('romaco_open_paper_position', input);
      const afterReplay = chart.paperPositions.length;
      const changed = await harness.callTool('romaco_open_paper_position', {
        ...input,
        quantity: 3,
      });
      const afterChanged = chart.paperPositions.length;
      return {
        challenge,
        opened,
        replay,
        changed,
        input,
        beforeWrites,
        afterChallenge,
        afterOpened,
        afterReplay,
        afterChanged,
      };
    },
  });
}

async function s05() {
  const aapl = realCandles('AAPL');
  const tsla = realCandles('TSLA');
  return runWithHarness({
    chart: disconnectedChart(),
    execute: async ({ harness, runtime }) => {
      const setupA = await harness.callTool('romaco_setup_chart', {
        symbol: 'AAPL', preset: 'clean', timeframe: '1d', source: 'raw', rawCandles: aapl,
      });
      const a = structured(setupA).data;
      const setupB = await harness.callTool('romaco_setup_chart', {
        symbol: 'TSLA', preset: 'clean', timeframe: '1d', source: 'raw', rawCandles: tsla,
      });
      const b = structured(setupB).data;
      // Establish B as current through public MCP before exact A retrieval.
      const activeB = await harness.callTool('romaco_thesis');
      const activeDatasetBefore = await runtime.datasets.getActive();
      const activeAnalysisBefore = await runtime.analyses.getActive();

      // Exercise public MCP correlation. Explicit artifact retrieval must neither
      // depend on nor mutate active B state.
      const explicitAResult = await harness.callTool('romaco_thesis', { analysisId: a.analysisId });
      const explicitA = structured(explicitAResult).data;

      const activeDatasetAfter = await runtime.datasets.getActive();
      const activeAnalysisAfter = await runtime.analyses.getActive();
      return {
        setupA,
        setupB,
        activeB,
        explicitAResult,
        explicitA: {
          analysisId: explicitA.analysisId,
          datasetId: explicitA.datasetId,
        },
        a: { analysisId: a.analysisId, datasetId: a.dataset.datasetId },
        b: { analysisId: b.analysisId, datasetId: b.dataset.datasetId },
        activeBefore: {
          analysisId: activeAnalysisBefore?.analysisId,
          datasetId: activeDatasetBefore?.datasetId,
        },
        activeAfter: {
          analysisId: activeAnalysisAfter?.analysisId,
          datasetId: activeDatasetAfter?.datasetId,
        },
      };
    },
  });
}

async function d02() {
  const candles = realCandles('AAPL');
  const userDrawing = { id: 'user_1', owner: 'user', groupId: null, type: 'trendline' };
  const chart = connectedChart('AAPL', '1d', candles, {
    drawings: [userDrawing],
    fault: { operation: 'replaceDrawingGroup', errorCode: 'Browser disconnected' },
  });
  return runWithHarness({
    chart,
    execute: async ({ harness, journal }) => {
      const setup = await harness.callTool('romaco_setup_chart', {
        symbol: 'AAPL', preset: 'clean', timeframe: '1d', source: 'raw', rawCandles: candles,
      });
      const analysisId = structured(setup).data.analysisId;
      const failedApproval = await approvedAnnotate(harness, analysisId);
      const stateAfterFailure = chart.state();
      const journalAfterFailure = Object.fromEntries(journal.groups);

      chart.fault = null;
      chart.connected = true;
      const recoveredApproval = await approvedAnnotate(harness, analysisId);
      return {
        setup,
        failedChallenge: failedApproval.challenge,
        failed: failedApproval.applied,
        recoveredChallenge: recoveredApproval.challenge,
        recovered: recoveredApproval.applied,
        stateAfterFailure,
        journalAfterFailure,
        userDrawingId: userDrawing.id,
      };
    },
  });
}

export const SUPPORTED_OFFLINE_TRIALS = new Map([
  ['raw-load-analyze', h01],
  ['headless-setup', h02],
  ['missing-session-recovery', h03],
  ['pattern-cost-gate', h04],
  ['flat-stand-aside', h05],
  ['invalid-target-recovery', h08],
  ['batch-partial-failure', h09],
  ['live-setup-identity', l01],
  ['context-cost-gate', l02],
  ['indicator-id-chain', l03],
  ['drawing-validation', l04],
  ['annotate-atomic-idempotent', l05],
  ['group-preserves-user-state', s04],
  ['reconnect-symbol-scope', s01],
  ['remove-indicator-reconnect', s02],
  ['remove-alert-reconnect', s03],
  ['cross-symbol-hard-stop', l06],
  ['pattern-group-replace', l07],
  ['snapshot-gate', l08],
  ['explicit-dataset-race', s05],
  ['annotate-approval', a01],
  ['clear-preview-apply', a02],
  ['paper-position-idempotency', a03],
  ['atomic-disconnect-recovery', d02],
]);
