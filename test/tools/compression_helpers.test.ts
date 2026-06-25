import { describe, it, expect } from 'vitest';
import {
  compressChartContext,
  compressVisibleCandles,
  compressIndicatorValues,
  trimPatternHits,
} from '../../src/compression/snapshot.js';
import type { PatternHit } from '../../src/compression/types.js';

describe('compressChartContext', () => {
  it('returns small object regardless of input size', () => {
    const huge = {
      visibleRange: { startTimestamp: 1, endTimestamp: 2, startIndex: 0, endIndex: 499 },
      visibleCandles: new Array(500).fill({ open: 1, high: 2, low: 0.5, close: 1.5, volume: 1000 }),
      existingDrawings: new Array(30).fill({ id: 'd1', type: 'trendline', points: [{}, {}] }),
      existingIndicators: new Array(10).fill({ id: 'i1', name: 'RSI', params: [14], visible: true }),
      panels: [
        { id: 'main', alias: 'main', indicators: [{ id: 'i1', name: 'EMA' }] },
        { id: 'p2', alias: 'rsi', indicators: [{ id: 'i2', name: 'RSI' }] },
      ],
      currentPrice: 100.5,
      totalCandles: 500,
      zoomLevel: 1.2,
      renderBackend: 'webgpu',
      alerts: [{}, {}],
      paperTrading: null,
      chartDimensions: { width: 800, height: 600 },
      locale: 'en',
      timezone: 'UTC',
    };
    const r = compressChartContext(huge);
    expect(r.lastPrice).toBe(100.5);
    expect(r.totalCandles).toBe(500);
    expect(r.indicatorCount).toBe(10);
    expect(r.drawingCount).toBe(30);
    expect(r.alertCount).toBe(2);
    expect(r.panes).toHaveLength(2);
    expect(r.paperTradingActive).toBe(false);
    const json = JSON.stringify(r);
    expect(json.length).toBeLessThan(2000);
  });

  it('injects main pane if missing', () => {
    const ctx = {
      panels: [{ id: 'p2', alias: 'rsi', indicators: [{ name: 'RSI' }] }],
      existingIndicators: [{ name: 'EMA', visible: true }],
    };
    const r = compressChartContext(ctx);
    expect(r.panes[0].alias).toBe('main');
    expect(r.panes[0].indicatorNames).toContain('EMA');
  });

  it('handles empty / undefined input gracefully', () => {
    expect(() => compressChartContext({})).not.toThrow();
    expect(() => compressChartContext(null)).not.toThrow();
    expect(() => compressChartContext(undefined)).not.toThrow();
    const r = compressChartContext({});
    expect(r.lastPrice).toBeNull();
    expect(r.totalCandles).toBe(0);
  });
});

describe('compressVisibleCandles', () => {
  it('returns small summary for big array', () => {
    const candles = Array.from({ length: 500 }, (_, i) => ({
      timestamp: 1700000000 + i * 60,
      open: 100 + i * 0.1,
      high: 100.5 + i * 0.1,
      low: 99.5 + i * 0.1,
      close: 100.2 + i * 0.1,
      volume: 1000 + i,
    }));
    const r = compressVisibleCandles(candles);
    expect(r.count).toBe(500);
    expect(r.first_ts).toBe(1700000000);
    expect(r.last_ts).toBe(1700000000 + 499 * 60);
    expect(r.ohlc_range!.minLow).toBeCloseTo(99.5);
    expect(r.ohlc_range!.maxHigh).toBeCloseTo(100.5 + 499 * 0.1);
    expect(r.volume!.sum).toBeGreaterThan(0);
    expect(r.volume!.max).toBe(1000 + 499);
    expect(r.returns!.pctChange).toBeCloseTo(((100.2 + 499 * 0.1 - 100) / 100) * 100);
    const json = JSON.stringify(r);
    expect(json.length).toBeLessThan(1000);
  });

  it('returns nulls for empty input', () => {
    const r = compressVisibleCandles([]);
    expect(r.count).toBe(0);
    expect(r.first_ts).toBeNull();
    expect(r.ohlc_range).toBeNull();
    expect(r.volume).toBeNull();
  });
});

describe('compressIndicatorValues', () => {
  it('classifies RSI overbought when last >= 70', () => {
    const r = compressIndicatorValues({
      name: 'RSI',
      params: [14],
      series: [{ name: 'value', values: [50, 60, 72] }],
    });
    expect(r.state).toBe('overbought');
    expect(r.lastValues.value).toBe(72);
    expect(r.prevValues.value).toBe(60);
    expect(r.deltas.value).toBe(12);
    expect(r.bars).toBe(3);
  });

  it('classifies RSI oversold when last <= 30', () => {
    const r = compressIndicatorValues({
      name: 'RSI',
      params: [14],
      series: [{ name: 'value', values: [40, 30, 25] }],
    });
    expect(r.state).toBe('oversold');
  });

  it('detects MACD bull cross', () => {
    const r = compressIndicatorValues({
      name: 'MACD',
      params: [12, 26, 9],
      series: [
        { name: 'macd', values: [-0.1, 0.05] },
        { name: 'signal', values: [-0.05, 0.02] },
        { name: 'histogram', values: [-0.05, 0.03] },
      ],
    });
    expect(r.state).toBe('bull_cross');
  });

  it('defaults to flat/rising/falling for unknown indicators', () => {
    const r = compressIndicatorValues({
      name: 'EMA',
      params: [20],
      series: [{ name: 'value', values: [100, 101] }],
    });
    expect(r.state).toBe('rising');
    const r2 = compressIndicatorValues({
      name: 'EMA',
      params: [20],
      series: [{ name: 'value', values: [101, 100] }],
    });
    expect(r2.state).toBe('falling');
  });

  it('strips full series array — output is small', () => {
    const big = Array.from({ length: 1000 }, (_, i) => i);
    const r = compressIndicatorValues({
      name: 'RSI',
      params: [14],
      series: [{ name: 'value', values: big }],
    });
    const json = JSON.stringify(r);
    expect(json.length).toBeLessThan(500);
  });

  it('accepts series with `key` (ChartAgentController shape)', () => {
    const r = compressIndicatorValues({
      name: 'RSI',
      params: [14],
      series: [{ key: 'value', values: [50, 60, 72] }],
    });
    expect(r.seriesNames).toEqual(['value']);
    expect(r.lastValues.value).toBe(72);
    expect(r.prevValues.value).toBe(60);
    expect(r.state).toBe('overbought');
  });

  it('skips trailing nulls — last value is latest computed, not latest bar', () => {
    // RSI(14) on 5 bars produces 4 nulls + 1 value. Last should be the value.
    const r = compressIndicatorValues({
      name: 'RSI',
      params: [14],
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      series: [{ key: 'value', values: [null, null, 50, 55, null] as any }],
    });
    expect(r.lastValues.value).toBe(55);
    expect(r.prevValues.value).toBe(50);
    expect(r.deltas.value).toBe(5);
  });
});

describe('trimPatternHits', () => {
  it('drops points[] but keeps key fields', () => {
    const hits: PatternHit[] = [
      {
        kind: 'head_shoulders',
        confidence: 0.95,
        points: [
          { ts: 1, price: 100, role: 'left_shoulder' },
          { ts: 2, price: 110, role: 'head' },
          { ts: 3, price: 100, role: 'right_shoulder' },
        ],
        target_price: 90,
        invalidation_price: 110,
      },
    ];
    const r = trimPatternHits(hits);
    expect(r).toHaveLength(1);
    expect(r[0].kind).toBe('head_shoulders');
    expect(r[0].confidence).toBeCloseTo(0.95);
    expect(r[0].target_price).toBe(90);
    expect(r[0].invalidation_price).toBe(110);
    expect(r[0].anchor_count).toBe(3);
    expect((r[0] as unknown as { points?: unknown }).points).toBeUndefined();
  });

  it('handles empty / non-array input', () => {
    expect(trimPatternHits([])).toEqual([]);
    expect(trimPatternHits(null as unknown as PatternHit[])).toEqual([]);
  });
});
