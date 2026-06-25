import { describe, expect, it } from 'vitest';
import { analyzeSession } from '../../src/compression/analyze.js';
import { detectPatterns } from '../../src/compression/patterns.js';
import { cachedDetectPatterns, memoScan } from '../../src/compression/scanCache.js';
import { composeMarketSummary } from '../../src/compression/summary.js';
import { doubleTopCandles } from './fixtures.js';
import { realCandles } from './real_fixtures.js';

/**
 * Scan memo — the redundancy killer.
 *
 * Before this layer, a typical agent flow (setup_chart → thesis → annotate →
 * draw_pattern) ran the identical full pattern scan four times: every tool
 * called the compression layer independently. These tests pin the three
 * contracts that make the memo safe:
 *   identity   — caching is keyed by candle-array identity (fresh array per load)
 *   stamp      — in-place mutation of the last bar is detected and recomputes
 *   immutability — cached results are deep-frozen; mutating consumers throw
 */

describe('memoScan', () => {
  it('computes once per (array, slot) and returns the same reference', () => {
    const candles = doubleTopCandles();
    let computes = 0;
    const a = memoScan(candles, 'x', () => ({ n: ++computes }));
    const b = memoScan(candles, 'x', () => ({ n: ++computes }));
    expect(computes).toBe(1);
    expect(b).toBe(a);
  });

  it('slots are independent on the same array', () => {
    const candles = doubleTopCandles();
    const a = memoScan(candles, 'a', () => ({ v: 1 }));
    const b = memoScan(candles, 'b', () => ({ v: 2 }));
    expect(a).not.toBe(b);
    expect(memoScan(candles, 'a', () => ({ v: 99 }))).toBe(a);
  });

  it('a different array with identical content recomputes (identity key)', () => {
    const one = doubleTopCandles();
    const two = doubleTopCandles();
    let computes = 0;
    memoScan(one, 'x', () => ++computes);
    memoScan(two, 'x', () => ++computes);
    expect(computes).toBe(2);
  });

  it('in-place mutation of the last bar invalidates the bundle (stamp)', () => {
    const candles = doubleTopCandles();
    let computes = 0;
    memoScan(candles, 'x', () => ++computes);
    candles[candles.length - 1] = { ...candles[candles.length - 1], close: 1 };
    memoScan(candles, 'x', () => ++computes);
    expect(computes).toBe(2);
  });

  it('empty arrays bypass the cache', () => {
    let computes = 0;
    memoScan([], 'x', () => ++computes);
    memoScan([], 'x', () => ++computes);
    expect(computes).toBe(2);
  });
});

describe('cachedDetectPatterns', () => {
  it('output is deep-equal to the raw engine (parity) and reference-stable', () => {
    const candles = realCandles('XOM');
    const cached = cachedDetectPatterns(candles);
    expect(cached).toEqual(detectPatterns(candles));
    expect(cachedDetectPatterns(candles)).toBe(cached);
  });

  it('cached hits are deep-frozen — mutation throws instead of corrupting', () => {
    const candles = realCandles('XOM');
    const hits = cachedDetectPatterns(candles);
    expect(hits.length).toBeGreaterThan(0);
    expect(() => {
      hits[0].confidence = 0;
    }).toThrow(TypeError);
    expect(() => {
      hits[0].points.push({ ts: 0, price: 0, role: 'evil' });
    }).toThrow(TypeError);
  });
});

describe('cross-entry sharing — the 4-tools-1-scan flow', () => {
  it('analyzeSession reuses the cached pattern scan and summary by reference', () => {
    const candles = realCandles('TSLA');
    const patterns = cachedDetectPatterns(candles); // detect_patterns tool ran first
    const analysis = analyzeSession(candles); //        then thesis
    const summary = composeMarketSummary(candles); //   then analyze_market / setup_chart
    expect(analysis.summary.patterns).toBe(patterns);
    expect(summary).toBe(analysis.summary);
    expect(analyzeSession(candles)).toBe(analysis); //  then annotate
  });

  it('empty candles still produce a fresh, uncached summary each call', () => {
    const a = composeMarketSummary([]);
    const b = composeMarketSummary([]);
    expect(a).not.toBe(b);
    expect(a).toEqual(b);
  });
});
