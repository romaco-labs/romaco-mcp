import { afterEach, describe, expect, it } from 'vitest';
import { chartState } from '../src/chartState.js';

afterEach(() => chartState.clear());

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
      'AAPL',
    );
    chartState.recordAlert({ action: 'addAlert', price: 150, options: { direction: 'above' } }, 'AAPL');
    const snap = chartState.snapshot();
    expect(snap.drawings).toHaveLength(1);
    expect(snap.alerts).toHaveLength(1);
    expect(snap.alerts[0].action).toEqual({ action: 'addAlert', price: 150, options: { direction: 'above' } });
  });

  it('clearDrawings empties only drawings, keeps indicators and alerts', () => {
    chartState.recordIndicator({ action: 'addIndicator', indicatorType: 'EMA', params: [20] }, 'AAPL');
    chartState.recordDrawing(
      { action: 'addDrawing', drawingType: 'rectangle', points: [{ timestamp: 1, price: 10 }, { timestamp: 2, price: 20 }] },
      'AAPL',
    );
    chartState.recordAlert({ action: 'addAlert', price: 150 }, 'AAPL');

    chartState.clearDrawings();

    const snap = chartState.snapshot();
    expect(snap.drawings).toHaveLength(0);
    expect(snap.indicators).toHaveLength(1);
    expect(snap.alerts).toHaveLength(1);
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
