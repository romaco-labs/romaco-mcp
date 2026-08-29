import { afterEach, describe, expect, it } from 'vitest';
import { chartState } from '../src/chartState.js';
import { createChartId } from '../src/domain/chart/model.js';
import { LegacyChartJournal } from '../src/bootstrap/LegacyChartJournal.js';

afterEach(() => chartState.clear());

const AAPL_DAILY = {
  chartId: createChartId('primary'), symbol: 'AAPL', timeframe: '1d' as const,
};

describe('ChartStateJournal — recordIndicator', () => {
  it('records an indicator with its symbol', () => {
    chartState.recordIndicator({ action: 'addIndicator', indicatorType: 'EMA', params: [20] }, 'AAPL');
    const snap = chartState.snapshot();
    expect(snap.indicators).toHaveLength(1);
    expect(snap.indicators[0]).toEqual({
      action: { action: 'addIndicator', indicatorType: 'EMA', params: [20] },
      symbol: 'AAPL',
    });
  });

  it('dedups same type+params (case-insensitive) — no stacking on replay', () => {
    chartState.recordIndicator({ action: 'addIndicator', indicatorType: 'EMA', params: [20] }, 'AAPL');
    chartState.recordIndicator({ action: 'addIndicator', indicatorType: 'ema', params: [20] }, 'MSFT');
    const snap = chartState.snapshot();
    expect(snap.indicators).toHaveLength(1);
    // most-recent symbol wins
    expect(snap.indicators[0].symbol).toBe('MSFT');
  });

  it('keeps distinct entries for different params', () => {
    chartState.recordIndicator({ action: 'addIndicator', indicatorType: 'EMA', params: [20] }, 'AAPL');
    chartState.recordIndicator({ action: 'addIndicator', indicatorType: 'EMA', params: [50] }, 'AAPL');
    expect(chartState.snapshot().indicators).toHaveLength(2);
  });

  it('treats missing params and [] as the same key', () => {
    chartState.recordIndicator({ action: 'addIndicator', indicatorType: 'VOL' }, 'AAPL');
    chartState.recordIndicator({ action: 'addIndicator', indicatorType: 'VOL', params: [] }, 'AAPL');
    expect(chartState.snapshot().indicators).toHaveLength(1);
  });

  it('stores null symbol when none loaded', () => {
    chartState.recordIndicator({ action: 'addIndicator', indicatorType: 'RSI', params: [14] }, null);
    expect(chartState.snapshot().indicators[0].symbol).toBeNull();
  });
});

describe('ChartStateJournal — drawings & alerts', () => {
  it('records drawings and alerts without dedup', () => {
    chartState.recordDrawing(
      { action: 'addDrawing', drawingType: 'trendline', points: [{ timestamp: 1, price: 10 }, { timestamp: 2, price: 20 }] },
      AAPL_DAILY,
    );
    chartState.recordAlert({ action: 'addAlert', price: 150, options: { direction: 'above' } }, AAPL_DAILY);
    const snap = chartState.snapshot();
    expect(snap.drawings).toHaveLength(1);
    expect(snap.alerts).toHaveLength(1);
    expect(snap.alerts[0].action).toEqual({ action: 'addAlert', price: 150, options: { direction: 'above' } });
  });

  it('stores complete chart identity for identity-aware drawings and alerts', () => {
    const identity = {
      chartId: createChartId('primary'), symbol: 'AAPL', timeframe: '1d' as const,
    };
    chartState.recordDrawing(
      { action: 'addDrawing', drawingType: 'horizontalLine', points: [{ timestamp: 1, price: 10 }] },
      identity,
    );
    chartState.recordAlert({ action: 'addAlert', price: 10 }, identity);

    expect(chartState.snapshot().drawings[0].identity).toEqual(identity);
    expect(chartState.snapshot().alerts[0].identity).toEqual(identity);
  });

  it('stores application group replacement as one complete bridge command', () => {
    const identity = {
      chartId: createChartId('primary'), symbol: 'AAPL', timeframe: '1d' as const,
    };
    new LegacyChartJournal().replaceDrawingGroup(
      'romaco-mcp/thesis',
      [{
        action: 'addDrawing', drawingType: 'horizontalLine',
        points: [{ timestamp: 1, price: 10 }], groupId: 'romaco-mcp/thesis',
      }],
      identity,
      'analysis_1:primary:thesis-v1',
      ['drawing-1'],
    );

    const state = chartState.snapshot();
    expect(state.drawings).toHaveLength(0);
    expect(state.drawingGroups).toHaveLength(1);
    expect(state.drawingGroups[0]).toMatchObject({
      identity,
      resourceIds: ['drawing-1'],
      action: {
        action: 'replaceAgentDrawingGroup',
        groupId: 'romaco-mcp/thesis',
        idempotencyKey: 'analysis_1:primary:thesis-v1',
        expectedIdentity: { chartId: 'primary', symbol: 'AAPL', resolution: '1d' },
      },
    });
  });

  it('clearDrawings empties only drawings, keeps indicators and alerts', () => {
    chartState.recordIndicator({ action: 'addIndicator', indicatorType: 'EMA', params: [20] }, 'AAPL');
    chartState.recordDrawing(
      { action: 'addDrawing', drawingType: 'rectangle', points: [{ timestamp: 1, price: 10 }, { timestamp: 2, price: 20 }] },
      AAPL_DAILY,
    );
    chartState.recordAlert({ action: 'addAlert', price: 150 }, AAPL_DAILY);

    chartState.clearDrawings();

    const snap = chartState.snapshot();
    expect(snap.drawings).toHaveLength(0);
    expect(snap.indicators).toHaveLength(1);
    expect(snap.alerts).toHaveLength(1);
  });

  it('removes a drawing group only from exact chart identity', () => {
    const other = {
      chartId: createChartId('secondary'), symbol: 'MSFT', timeframe: '1h' as const,
    };
    const action = {
      action: 'addDrawing' as const,
      drawingType: 'horizontalLine',
      groupId: 'romaco-mcp/manual',
      points: [{ timestamp: 1, price: 10 }],
    };
    chartState.recordDrawing(action, AAPL_DAILY);
    chartState.recordDrawing(action, other);

    chartState.removeDrawingsByGroupForIdentity('romaco-mcp/manual', AAPL_DAILY);

    expect(chartState.snapshot().drawings).toHaveLength(1);
    expect(chartState.snapshot().drawings[0].identity).toEqual(other);
  });
});

describe('ChartStateJournal — snapshot isolation', () => {
  it('snapshot returns copies, not live references', () => {
    chartState.recordIndicator({ action: 'addIndicator', indicatorType: 'EMA', params: [20] }, 'AAPL');
    const snap = chartState.snapshot();
    snap.indicators.push({ action: { action: 'addIndicator', indicatorType: 'X' }, symbol: null });
    expect(chartState.snapshot().indicators).toHaveLength(1);
  });
});
