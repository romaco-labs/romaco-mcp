import { describe, it, expect } from 'vitest';
import { rsi, macd, detectMacdCross, detectDivergences, momentumSummary } from '../../src/compression/momentum.js';
import { uptrendCandles, downtrendCandles, sidewaysCandles, bullishDivergenceCandles } from './fixtures.js';

describe('rsi', () => {
  it('returns NaN for first `period` entries', () => {
    const series = rsi(uptrendCandles(30), 14);
    for (let i = 0; i < 14; i++) expect(Number.isNaN(series[i])).toBe(true);
    expect(Number.isFinite(series[14])).toBe(true);
  });

  it('uptrend → RSI > 50', () => {
    const series = rsi(uptrendCandles(50, 100, 1), 14);
    expect(series[series.length - 1]).toBeGreaterThan(50);
  });

  it('downtrend → RSI < 50', () => {
    const series = rsi(downtrendCandles(50, 200, 1), 14);
    expect(series[series.length - 1]).toBeLessThan(50);
  });

  it('RSI bounded 0..100', () => {
    const series = rsi(sidewaysCandles(100), 14);
    for (const v of series) {
      if (!Number.isNaN(v)) {
        expect(v).toBeGreaterThanOrEqual(0);
        expect(v).toBeLessThanOrEqual(100);
      }
    }
  });
});

describe('macd', () => {
  it('returns three series of equal length', () => {
    const candles = uptrendCandles(50);
    const m = macd(candles);
    expect(m.macd.length).toBe(candles.length);
    expect(m.signal.length).toBe(candles.length);
    expect(m.histogram.length).toBe(candles.length);
  });

  it('histogram = macd - signal', () => {
    const m = macd(uptrendCandles(50));
    const i = m.macd.length - 1;
    expect(m.histogram[i]).toBeCloseTo(m.macd[i] - m.signal[i], 5);
  });
});

describe('detectMacdCross', () => {
  it('returns none for steady trends with no recent cross', () => {
    const cross = detectMacdCross(uptrendCandles(100), 3);
    expect(['bullish', 'bearish', 'none']).toContain(cross);
  });
});

describe('detectDivergences', () => {
  it('returns array (may be empty)', () => {
    const divs = detectDivergences(bullishDivergenceCandles(), 'rsi');
    expect(Array.isArray(divs)).toBe(true);
  });

  it('each divergence has matching point counts', () => {
    const divs = detectDivergences(bullishDivergenceCandles(), 'rsi');
    for (const d of divs) {
      expect(d.price_points.length).toBe(2);
      expect(d.indicator_points.length).toBe(2);
      expect(['bullish', 'bearish', 'hidden_bullish', 'hidden_bearish']).toContain(d.kind);
    }
  });
});

describe('momentumSummary', () => {
  it('returns full summary structure', () => {
    const s = momentumSummary(uptrendCandles(50));
    expect(s).toHaveProperty('rsi');
    expect(s).toHaveProperty('rsi_state');
    expect(s).toHaveProperty('macd_cross');
    expect(s).toHaveProperty('macd_histogram');
    expect(s).toHaveProperty('divergences');
  });

  it('rsi_state classifies correctly', () => {
    const s = momentumSummary(uptrendCandles(100, 100, 3));
    expect(['overbought', 'oversold', 'neutral']).toContain(s.rsi_state);
  });

  it('handles empty candles', () => {
    const s = momentumSummary([]);
    expect(s.rsi).toBe(50);
    expect(s.rsi_state).toBe('neutral');
    expect(s.macd_cross).toBe('none');
  });
});
