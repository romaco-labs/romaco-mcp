import { describe, it, expect } from 'vitest';
import { findLevels } from '../../src/compression/levels.js';
import { sidewaysCandles, uptrendCandles, doubleTopCandles } from './fixtures.js';

describe('findLevels', () => {
  it('returns empty levels for no candles', () => {
    const l = findLevels([]);
    expect(l.support).toEqual([]);
    expect(l.resistance).toEqual([]);
    expect(l.poc).toBe(0);
  });

  it('support levels are below current price', () => {
    const candles = uptrendCandles(80, 100, 1);
    const l = findLevels(candles);
    const currentPrice = candles[candles.length - 1].close;
    for (const s of l.support) expect(s).toBeLessThan(currentPrice);
  });

  it('resistance levels are above current price', () => {
    const candles = uptrendCandles(80, 100, 1);
    const l = findLevels(candles);
    const currentPrice = candles[candles.length - 1].close;
    for (const r of l.resistance) expect(r).toBeGreaterThan(currentPrice);
  });

  it('returns max 3 support and 3 resistance', () => {
    const l = findLevels(sidewaysCandles(100));
    expect(l.support.length).toBeLessThanOrEqual(3);
    expect(l.resistance.length).toBeLessThanOrEqual(3);
  });

  it('POC is within candle price range', () => {
    const candles = uptrendCandles(50, 100, 1);
    const l = findLevels(candles);
    const minLow = Math.min(...candles.map(c => c.low));
    const maxHigh = Math.max(...candles.map(c => c.high));
    expect(l.poc).toBeGreaterThanOrEqual(minLow);
    expect(l.poc).toBeLessThanOrEqual(maxHigh);
  });

  it('VAH >= POC >= VAL', () => {
    const l = findLevels(uptrendCandles(80));
    expect(l.vah).toBeGreaterThanOrEqual(l.poc);
    expect(l.poc).toBeGreaterThanOrEqual(l.val);
  });

  it('finds resistance near double top peak', () => {
    const candles = doubleTopCandles();
    const l = findLevels(candles);
    // Two tops at 120 — at least one level should be near 118-120
    const hasNearTop = [...l.support, ...l.resistance].some(lvl => lvl >= 115 && lvl <= 122);
    expect(hasNearTop).toBe(true);
  });
});

describe('findLevels — withDetail enrichment', () => {
  it('default call carries NO detail field (MarketSummary stays lean)', () => {
    expect(findLevels(doubleTopCandles()).detail).toBeUndefined();
  });

  it('withDetail reports touches/strength/last_touch_ts per level', () => {
    const candles = doubleTopCandles();
    const l = findLevels(candles, { withDetail: true });
    expect(l.detail).toBeDefined();
    const all = [...l.detail!.support, ...l.detail!.resistance];
    expect(all.length).toBe(l.support.length + l.resistance.length);
    for (const d of all) {
      expect(d.touches).toBeGreaterThanOrEqual(0);
      expect(d.strength).toBeGreaterThanOrEqual(0);
      expect(d.strength).toBeLessThanOrEqual(1);
    }
    // The double-top cluster (~120) was tested twice.
    const top = all.find((d) => d.price >= 115 && d.price <= 122);
    if (top) {
      expect(top.touches).toBeGreaterThanOrEqual(2);
      expect(top.last_touch_ts).toBeGreaterThan(0);
    }
  });

  it('withDetail does not change the level prices themselves', () => {
    const candles = doubleTopCandles();
    const plain = findLevels(candles);
    const rich = findLevels(candles, { withDetail: true });
    expect(rich.support).toEqual(plain.support);
    expect(rich.resistance).toEqual(plain.resistance);
    expect(rich.poc).toBe(plain.poc);
  });
});
