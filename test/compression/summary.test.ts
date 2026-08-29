import { describe, it, expect } from 'vitest';
import { composeMarketSummary } from '../../src/compression/summary.js';
import { uptrendCandles, downtrendCandles, sidewaysCandles, headShouldersCandles } from './fixtures.js';
import { realCandles } from './real_fixtures.js';

const REAL_FIXTURE_SYMBOLS = ['TSLA', 'XOM', 'AAPL', 'MSTR', 'SPY', 'META', 'KO', 'JPM'] as const;

describe('composeMarketSummary', () => {
  it('returns full MarketSummary structure', () => {
    const s = composeMarketSummary(uptrendCandles(50));
    expect(s).toHaveProperty('meta');
    expect(s).toHaveProperty('trend');
    expect(s).toHaveProperty('plr');
    expect(s).toHaveProperty('levels');
    expect(s).toHaveProperty('momentum');
    expect(s).toHaveProperty('volatility');
    expect(s).toHaveProperty('patterns');
  });

  it('meta reflects input candles', () => {
    const candles = uptrendCandles(50);
    const s = composeMarketSummary(candles);
    expect(s.meta.candle_count).toBe(50);
    expect(s.meta.first_ts).toBe(candles[0].timestamp);
    expect(s.meta.last_ts).toBe(candles[candles.length - 1].timestamp);
    expect(s.meta.last_price).toBe(candles[candles.length - 1].close);
  });

  it('handles empty input gracefully', () => {
    const s = composeMarketSummary([]);
    expect(s.meta.candle_count).toBe(0);
    expect(s.trend.direction).toBe('sideways');
    expect(s.plr).toEqual([]);
    expect(s.patterns).toEqual([]);
  });

  it('trend matches expected direction', () => {
    const up = composeMarketSummary(uptrendCandles(50));
    expect(up.trend.direction).toBe('up');

    const down = composeMarketSummary(downtrendCandles(50));
    expect(down.trend.direction).toBe('down');
  });

  it('infers timeframe from candle spacing', () => {
    const s = composeMarketSummary(uptrendCandles(10));
    expect(s.meta.timeframe_seconds).toBe(3600); // 1h fixture
  });

  it('summary is JSON-serializable', () => {
    const s = composeMarketSummary(headShouldersCandles());
    expect(() => JSON.stringify(s)).not.toThrow();
  });

  it('summary stays bounded — features dominate over raw at 100+ candles', () => {
    // Summary size is dominated by patterns/divergences/levels (sparse).
    // For noisy data with many pivots, may approach raw size. Compression wins at scale.
    const s = composeMarketSummary(sidewaysCandles(100, 100, 2));
    const json = JSON.stringify(s);
    expect(json.length).toBeLessThan(25_000);
  });

  it('compresses 1000 candles by at least 20x', () => {
    const candles = uptrendCandles(1000, 100, 0.5, 1);
    const rawSize = JSON.stringify(candles).length;
    const summary = composeMarketSummary(candles);
    const summarySize = JSON.stringify(summary).length;
    expect(summarySize).toBeLessThan(rawSize / 20);
  });

  it('keeps every recorded 400-bar market summary under the documented 4.5 KB budget', () => {
    for (const symbol of REAL_FIXTURE_SYMBOLS) {
      const summary = JSON.stringify(composeMarketSummary(realCandles(symbol)));
      expect(Buffer.byteLength(summary, 'utf8'), symbol).toBeLessThan(4_500);
    }
  });
});
