import { describe, it, expect } from 'vitest';
import { detectTrend, piecewiseLinear } from '../../src/compression/trend.js';
import { uptrendCandles, downtrendCandles, sidewaysCandles } from './fixtures.js';

describe('detectTrend', () => {
  it('detects strong uptrend', () => {
    const t = detectTrend(uptrendCandles(50, 100, 1));
    expect(t.direction).toBe('up');
    expect(t.strength).toBeGreaterThan(0.9);
    expect(t.slope_pct_per_candle).toBeGreaterThan(0);
  });

  it('detects strong downtrend', () => {
    const t = detectTrend(downtrendCandles(50, 200, 1));
    expect(t.direction).toBe('down');
    expect(t.strength).toBeGreaterThan(0.9);
    expect(t.slope_pct_per_candle).toBeLessThan(0);
  });

  it('detects sideways market', () => {
    const t = detectTrend(sidewaysCandles(50, 100, 1));
    expect(t.direction).toBe('sideways');
  });

  it('returns sideways for empty candles', () => {
    const t = detectTrend([]);
    expect(t.direction).toBe('sideways');
    expect(t.strength).toBe(0);
  });

  it('strength is 0..1', () => {
    const t = detectTrend(uptrendCandles(30));
    expect(t.strength).toBeGreaterThanOrEqual(0);
    expect(t.strength).toBeLessThanOrEqual(1);
  });
});

describe('piecewiseLinear', () => {
  it('produces at most maxSegments segments', () => {
    const segs = piecewiseLinear(uptrendCandles(100), 8);
    expect(segs.length).toBeLessThanOrEqual(8);
  });

  it('returns empty for fewer than 2 candles', () => {
    expect(piecewiseLinear([])).toEqual([]);
    expect(piecewiseLinear(uptrendCandles(1))).toEqual([]);
  });

  it('preserves time ordering', () => {
    const segs = piecewiseLinear(uptrendCandles(50));
    for (let i = 1; i < segs.length; i++) {
      expect(segs[i].from_ts).toBeGreaterThanOrEqual(segs[i - 1].from_ts);
    }
  });

  it('classifies uptrend segments as impulse when magnitude > 2%', () => {
    const segs = piecewiseLinear(uptrendCandles(50, 100, 5), 4);
    const impulses = segs.filter(s => s.kind === 'impulse');
    expect(impulses.length).toBeGreaterThan(0);
  });

  it('classifies sideways as consolidation', () => {
    const segs = piecewiseLinear(sidewaysCandles(50, 100, 0.2), 4);
    const consolidations = segs.filter(s => s.kind === 'consolidation');
    expect(consolidations.length).toBeGreaterThan(0);
  });

  it('magnitude_pct sign matches direction', () => {
    const upSegs = piecewiseLinear(uptrendCandles(30, 100, 2), 3);
    expect(upSegs[upSegs.length - 1].magnitude_pct).toBeGreaterThan(0);

    const downSegs = piecewiseLinear(downtrendCandles(30, 200, 2), 3);
    expect(downSegs[0].magnitude_pct).toBeLessThan(0);
  });
});
