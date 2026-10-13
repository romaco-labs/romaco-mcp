import { describe, expect, it } from 'vitest';
import { findLevels } from '../../src/compression/levels.js';
import { momentumSummary } from '../../src/compression/momentum.js';
import { volatilitySummary } from '../../src/compression/volatility.js';
import { composeMarketSummary } from '../../src/compression/summary.js';
import { composeThesis } from '../../src/compression/thesis.js';
import { compressVisibleCandles } from '../../src/compression/snapshot.js';
import {
  MIN_ATR_CANDLES,
  MIN_BOLLINGER_CANDLES,
  MIN_MACD_CANDLES,
  MIN_RSI_CANDLES,
  MIN_THESIS_CANDLES,
} from '../../src/compression/minimums.js';
import { sidewaysCandles, uptrendCandles } from './fixtures.js';
import type { Candle } from '../../src/compression/types.js';

const withVolume = (candles: Candle[], volume: (index: number) => number): Candle[] =>
  candles.map((candle, index) => ({ ...candle, volume: volume(index) }));

describe('volume levels without volume', () => {
  it('reports POC/VAH/VAL as null instead of the bottom of the range', () => {
    const levels = findLevels(withVolume(sidewaysCandles(80, 100, 4), () => 0));
    expect(levels).toMatchObject({ poc: null, vah: null, val: null, volume_status: 'insufficient' });
    // Price-only levels are still real and still reported.
    expect(levels.support.length + levels.resistance.length).toBeGreaterThan(0);
  });

  it('needs volume on at least half of the candles', () => {
    const base = sidewaysCandles(80, 100, 4);
    const sparse = findLevels(withVolume(base, (i) => (i % 10 < 4 ? 1_000 : 0)));
    expect(sparse.volume_status).toBe('insufficient');
    expect(sparse.poc).toBeNull();
    const enough = findLevels(withVolume(base, (i) => (i % 10 < 6 ? 1_000 : 0)));
    expect(enough.volume_status).toBe('ok');
    expect(enough.poc).toEqual(expect.any(Number));
  });
});

describe('warm-up minimums', () => {
  const series = (n: number) => uptrendCandles(n, 100, 0.5, 0.8);

  it('RSI and MACD are null until warmed up', () => {
    expect(momentumSummary(series(MIN_RSI_CANDLES - 1))).toMatchObject({ rsi: null, rsi_state: 'insufficient_data' });
    expect(momentumSummary(series(MIN_RSI_CANDLES)).rsi).toEqual(expect.any(Number));
    expect(momentumSummary(series(MIN_MACD_CANDLES - 1))).toMatchObject({
      macd_cross: 'insufficient_data',
      macd_histogram: null,
    });
    const ready = momentumSummary(series(MIN_MACD_CANDLES));
    expect(ready.macd_cross).not.toBe('insufficient_data');
    expect(ready.macd_histogram).toEqual(expect.any(Number));
  });

  it('ATR and Bollinger readings are null until warmed up', () => {
    expect(volatilitySummary(series(MIN_ATR_CANDLES - 1))).toMatchObject({ atr: null, atr_pct: null });
    expect(volatilitySummary(series(MIN_ATR_CANDLES)).atr).toEqual(expect.any(Number));
    expect(volatilitySummary(series(MIN_BOLLINGER_CANDLES - 1))).toMatchObject({
      bb_squeeze: null,
      bb_width_pct: null,
      state: 'insufficient_data',
    });
    expect(volatilitySummary(series(MIN_BOLLINGER_CANDLES)).state).not.toBe('insufficient_data');
  });

  it('a thesis stands aside on too few candles instead of reading defaults', () => {
    const thesis = composeThesis(composeMarketSummary(series(MIN_THESIS_CANDLES - 1)));
    expect(thesis.verdict).toBe('stand_aside');
    expect(thesis.setup).toBeNull();
    expect(thesis.bull).toEqual([]);
    expect(thesis.bear).toEqual([]);
    expect(thesis.notes[0]).toMatch(/^insufficient data: \d+ candles, a thesis needs at least 38$/);
  });

  it('a thesis on data without volume uses no POC factor or value-area levels', () => {
    const candles = withVolume(uptrendCandles(120, 100, 0.5, 0.8), () => 0);
    const summary = composeMarketSummary(candles);
    expect(summary.levels.poc).toBeNull();
    const thesis = composeThesis(summary);
    const factors = [...thesis.bull, ...thesis.bear].map((point) => point.factor);
    expect(factors).not.toContain('above_poc');
    expect(factors).not.toContain('below_poc');
  });
});

describe('visible candle stats', () => {
  it('report no volume instead of zero volume', () => {
    const stats = compressVisibleCandles([
      { timestamp: 1, open: 10, high: 11, low: 9, close: 10.5 },
      { timestamp: 2, open: 10.5, high: 12, low: 10, close: 11, volume: 0 },
    ]);
    expect(stats.volume).toBeNull();
  });

  it('average volume over the candles that report it', () => {
    const stats = compressVisibleCandles([
      { timestamp: 1, open: 10, high: 11, low: 9, close: 10.5, volume: 300 },
      { timestamp: 2, open: 10.5, high: 12, low: 10, close: 11 },
    ]);
    expect(stats.volume).toEqual({ sum: 300, avg: 300, max: 300, bars_with_volume: 1 });
  });

  it('leave single-candle ATR and unknown-open change empty', () => {
    const stats = compressVisibleCandles([{ timestamp: 1, high: 11, low: 9, close: 10.5, volume: 5 }]);
    expect(stats.returns).toEqual({ pctChange: null, atrApprox: null });
  });
});
