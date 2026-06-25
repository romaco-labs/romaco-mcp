import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { reconcileChartState } from '../src/reconcile.js';
import { chartState } from '../src/chartState.js';
import { bridge } from '../src/bridge.js';
import { session } from '../src/session.js';
import type { LoadResponse } from '../src/data/types.js';

const EMA20 = { action: 'addIndicator', indicatorType: 'EMA', params: [20] } as const;
const TREND = {
  action: 'addDrawing',
  drawingType: 'trendline',
  points: [{ timestamp: 1, price: 10 }, { timestamp: 2, price: 20 }],
} as const;
const ALERT = { action: 'addAlert', price: 150, options: { direction: 'above' as const } } as const;

/** Stub session so the "current symbol" is deterministic. */
function loadSymbol(symbol: string | null): void {
  vi.spyOn(session, 'getLastLoad').mockReturnValue(
    symbol === null ? null : ({ symbol } as LoadResponse),
  );
}

/** Stub bridge.getContext to return a given chart context. */
function ctx(partial: Record<string, unknown>) {
  return vi.spyOn(bridge, 'getContext').mockResolvedValue(partial);
}

afterEach(() => {
  chartState.clear();
  vi.restoreAllMocks();
});

beforeEach(() => {
  // Default: every executeAction succeeds.
  vi.spyOn(bridge, 'executeAction').mockResolvedValue({ success: true });
});

describe('reconcileChartState', () => {
  it('empty journal → never calls getContext', async () => {
    const getCtx = ctx({});
    await reconcileChartState();
    expect(getCtx).not.toHaveBeenCalled();
  });

  it('fresh chart (empty context) → replays indicators + drawings + alerts', async () => {
    chartState.recordIndicator(EMA20, 'AAPL');
    chartState.recordDrawing(TREND, 'AAPL');
    chartState.recordAlert(ALERT, 'AAPL');
    loadSymbol('AAPL');
    ctx({ existingIndicators: [], existingDrawings: [], alerts: [] });

    await reconcileChartState();

    const exec = bridge.executeAction as ReturnType<typeof vi.fn>;
    expect(exec).toHaveBeenCalledTimes(3);
    const sent = exec.mock.calls.map((c) => c[0]);
    expect(sent).toContainEqual(EMA20);
    expect(sent).toContainEqual(TREND);
    expect(sent).toContainEqual(ALERT);
  });

  it('same chart (context already has everything) → applies nothing (idempotent)', async () => {
    chartState.recordIndicator(EMA20, 'AAPL');
    chartState.recordDrawing(TREND, 'AAPL');
    chartState.recordAlert(ALERT, 'AAPL');
    loadSymbol('AAPL');
    ctx({
      existingIndicators: [{ name: 'EMA', params: [20], visible: true }],
      existingDrawings: [{ type: 'trendline', points: [{ timestamp: 1, price: 10 }, { timestamp: 2, price: 20 }] }],
      alerts: [{ price: 150, direction: 'above' }],
    });

    await reconcileChartState();

    expect(bridge.executeAction).not.toHaveBeenCalled();
  });

  it('different symbol → indicators replay, drawings/alerts skipped', async () => {
    chartState.recordIndicator(EMA20, 'AAPL');
    chartState.recordDrawing(TREND, 'AAPL');
    chartState.recordAlert(ALERT, 'AAPL');
    loadSymbol('MSFT'); // chart now showing a different symbol
    ctx({ existingIndicators: [], existingDrawings: [], alerts: [] });

    await reconcileChartState();

    const exec = bridge.executeAction as ReturnType<typeof vi.fn>;
    expect(exec).toHaveBeenCalledTimes(1);
    expect(exec.mock.calls[0][0]).toEqual(EMA20);
  });

  it('partial context → only the missing overlay is applied', async () => {
    chartState.recordIndicator(EMA20, 'AAPL');
    chartState.recordIndicator({ action: 'addIndicator', indicatorType: 'RSI', params: [14] }, 'AAPL');
    loadSymbol('AAPL');
    ctx({ existingIndicators: [{ name: 'EMA', params: [20], visible: true }], existingDrawings: [], alerts: [] });

    await reconcileChartState();

    const exec = bridge.executeAction as ReturnType<typeof vi.fn>;
    expect(exec).toHaveBeenCalledTimes(1);
    expect(exec.mock.calls[0][0]).toEqual({ action: 'addIndicator', indicatorType: 'RSI', params: [14] });
  });

  it('best-effort: one failed apply does not abort the rest', async () => {
    chartState.recordIndicator(EMA20, 'AAPL');
    chartState.recordIndicator({ action: 'addIndicator', indicatorType: 'RSI', params: [14] }, 'AAPL');
    loadSymbol('AAPL');
    ctx({ existingIndicators: [], existingDrawings: [], alerts: [] });

    const exec = vi
      .spyOn(bridge, 'executeAction')
      .mockRejectedValueOnce(new Error('boom'))
      .mockResolvedValue({ success: true });

    await expect(reconcileChartState()).resolves.toBeUndefined();
    expect(exec).toHaveBeenCalledTimes(2);
  });

  it('getContext failure on every attempt → returns without throwing, applies nothing', async () => {
    chartState.recordIndicator(EMA20, 'AAPL');
    loadSymbol('AAPL');
    const getCtx = vi.spyOn(bridge, 'getContext').mockRejectedValue(new Error('disconnected'));

    await expect(reconcileChartState({ attempts: 3, delayMs: 1 })).resolves.toBeUndefined();
    expect(getCtx).toHaveBeenCalledTimes(3);
    expect(bridge.executeAction).not.toHaveBeenCalled();
  });

  it('"Chart not ready" on first attempt → retries until context appears, then replays', async () => {
    chartState.recordDrawing(TREND, 'AAPL');
    loadSymbol('AAPL');
    vi.spyOn(bridge, 'getContext')
      .mockRejectedValueOnce(new Error('Chart not ready'))
      .mockResolvedValue({ existingIndicators: [], existingDrawings: [], alerts: [], totalCandles: 300 });

    await reconcileChartState({ delayMs: 1 });

    const exec = bridge.executeAction as ReturnType<typeof vi.fn>;
    expect(exec).toHaveBeenCalledTimes(1);
    expect(exec.mock.calls[0][0]).toEqual(TREND);
  });

  it('chart shell with zero candles → waits for data before replaying', async () => {
    chartState.recordDrawing(TREND, 'AAPL');
    loadSymbol('AAPL');
    const getCtx = vi
      .spyOn(bridge, 'getContext')
      .mockResolvedValueOnce({ existingDrawings: [], totalCandles: 0 })
      .mockResolvedValue({ existingIndicators: [], existingDrawings: [], alerts: [], totalCandles: 300 });

    await reconcileChartState({ delayMs: 1 });

    expect(getCtx).toHaveBeenCalledTimes(2);
    expect(bridge.executeAction).toHaveBeenCalledTimes(1);
  });

  it('prefers the chart-reported symbol over a stale session symbol', async () => {
    chartState.recordDrawing(TREND, 'NVDA');
    loadSymbol('AAPL'); // session is stale — the browser switched to NVDA
    ctx({ existingIndicators: [], existingDrawings: [], alerts: [], symbol: 'NVDA', totalCandles: 300 });

    await reconcileChartState();

    const exec = bridge.executeAction as ReturnType<typeof vi.fn>;
    expect(exec).toHaveBeenCalledTimes(1);
    expect(exec.mock.calls[0][0]).toEqual(TREND);
  });

  it('omitted alert direction matches a "cross" alert in context (no double-add)', async () => {
    chartState.recordAlert({ action: 'addAlert', price: 99, options: {} }, 'AAPL');
    loadSymbol('AAPL');
    ctx({ existingIndicators: [], existingDrawings: [], alerts: [{ price: 99, direction: 'cross' }] });

    await reconcileChartState();

    expect(bridge.executeAction).not.toHaveBeenCalled();
  });
});
