import { describe, expect, it } from 'vitest';
import { detectGaps } from '../../src/compression/gaps.js';
import { breachedSinceCompletion } from '../../src/compression/patterns.js';
import { findCandleSwings, minReversalFromAtr, zigzagFilter } from '../../src/compression/pivots.js';
import { buildScanContext } from '../../src/compression/scanContext.js';
import type { Candle, PatternHit } from '../../src/compression/types.js';

/**
 * Differential tests for ScanContext — the v1 loops are kept verbatim as the
 * no-ctx path inside breachedSinceCompletion/detectGaps, so the oracle is the
 * SAME function called without a context. Equivalence here means the suffix
 * extrema and the binary-search index are drop-in: bit-identical booleans,
 * deep-equal hits.
 */

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function randomWalk(n: number, seed: number): Candle[] {
  const rnd = mulberry32(seed);
  const out: Candle[] = [];
  let close = 100;
  for (let i = 0; i < n; i++) {
    const open = close;
    close = Math.max(1, close + (rnd() - 0.5) * 2);
    out.push({
      timestamp: 1_600_000_000 + i * 3600,
      open,
      high: Math.max(open, close) + rnd() * 0.6,
      low: Math.min(open, close) - rnd() * 0.6,
      close,
      volume: 1000,
    });
  }
  return out;
}

function trendingGappy(n: number, seed: number): Candle[] {
  const rnd = mulberry32(seed);
  const out: Candle[] = [];
  let close = 100;
  for (let i = 0; i < n; i++) {
    const gap = i > 0 && i % 10 === 0 ? close * 0.02 : 0;
    const open = close + gap;
    close = open + close * 0.004 + (rnd() - 0.3) * close * 0.004;
    out.push({
      timestamp: 1_600_000_000 + i * 3600,
      open,
      high: Math.max(open, close) * (1 + rnd() * 0.001),
      low: Math.min(open, close) * (1 - rnd() * 0.001),
      close,
      volume: 1000,
    });
  }
  return out;
}

describe('suffix extrema', () => {
  it('match brute-force min/max over every suffix', () => {
    const candles = randomWalk(137, 11);
    const ctx = buildScanContext(candles);
    for (let i = 0; i <= candles.length; i++) {
      let lo = Infinity;
      let hi = -Infinity;
      for (let j = i; j < candles.length; j++) {
        lo = Math.min(lo, candles[j].low);
        hi = Math.max(hi, candles[j].high);
      }
      expect(ctx.suffixMinLow[i]).toBe(lo);
      expect(ctx.suffixMaxHigh[i]).toBe(hi);
    }
  });
});

describe('shared ATR / zigzag parity with the v1 per-call computations', () => {
  it('lastAtr, minReversal and zigzag reproduce the old code paths exactly', () => {
    for (const seed of [1, 2, 3]) {
      const candles = randomWalk(220, seed);
      const ctx = buildScanContext(candles);
      // v1 oracle: zigzagFilter(findCandleSwings(c), minReversalFromAtr(c))
      const minRev = minReversalFromAtr(candles);
      expect(ctx.minReversal).toBe(minRev);
      expect(ctx.zigzag).toEqual(zigzagFilter(findCandleSwings(candles, 3), minRev));
    }
  });

  it('short series fall back to 0.5% of last close (no finite ATR)', () => {
    const candles = randomWalk(8, 5);
    const ctx = buildScanContext(candles);
    expect(ctx.lastAtr).toBe(0);
    expect(ctx.minReversal).toBe(candles[candles.length - 1].close * 0.005);
  });
});

describe('breachedSinceCompletion: ctx path ≡ v1 loop', () => {
  function syntheticHit(candles: Candle[], rnd: () => number): PatternHit {
    // Completion anywhere in the series; levels spread around the price range
    // so breached/clean/edge cases all occur across seeds.
    const i = Math.floor(rnd() * candles.length);
    const ts = candles[i].timestamp + (rnd() < 0.2 ? 1800 : 0); // some off-bar timestamps
    const span = 6 * (1 + rnd());
    const mid = candles[i].close;
    const hit: PatternHit = {
      kind: 'double_top',
      confidence: 0.7,
      points: [{ ts, price: mid, role: 'top_2' }],
    };
    if (rnd() < 0.85) hit.invalidation_price = mid + (rnd() - 0.5) * span;
    if (rnd() < 0.85) hit.target_price = mid + (rnd() - 0.5) * span;
    return hit;
  }

  it('1,000 randomized (series, hit) cases agree exactly', () => {
    const rnd = mulberry32(99);
    let breached = 0;
    for (let s = 0; s < 100; s++) {
      const candles = randomWalk(120, 1000 + s);
      const ctx = buildScanContext(candles);
      for (let h = 0; h < 10; h++) {
        const hit = syntheticHit(candles, rnd);
        const v1 = breachedSinceCompletion(hit, candles);
        const v2 = breachedSinceCompletion(hit, candles, ctx);
        expect(v2).toBe(v1);
        if (v1) breached++;
      }
    }
    // Sanity: the case mix actually exercises both outcomes.
    expect(breached).toBeGreaterThan(100);
    expect(breached).toBeLessThan(900);
  });

  it('unsorted candles (raw source) take the exact v1 fallback', () => {
    const candles = randomWalk(60, 7);
    // Swap two blocks so timestamps are NOT monotonic.
    const shuffled = [...candles.slice(30), ...candles.slice(0, 30)];
    const ctx = buildScanContext(shuffled);
    expect(ctx.sortedByTs).toBe(false);
    const rnd = mulberry32(123);
    for (let h = 0; h < 50; h++) {
      const hit = syntheticHit(shuffled, rnd);
      expect(breachedSinceCompletion(hit, shuffled, ctx)).toBe(
        breachedSinceCompletion(hit, shuffled),
      );
    }
  });

  it('duplicate timestamps resolve to the same completion bar as the v1 scan', () => {
    const candles = randomWalk(40, 13);
    candles[20] = { ...candles[20], timestamp: candles[19].timestamp }; // duplicate run
    const ctx = buildScanContext(candles);
    expect(ctx.sortedByTs).toBe(true);
    expect(ctx.lastIndexAtOrBefore(candles[19].timestamp)).toBe(20);
    expect(ctx.lastIndexAtOrBefore(candles[0].timestamp - 1)).toBe(-1);
    expect(ctx.lastIndexAtOrBefore(candles[39].timestamp + 999)).toBe(39);
  });
});

describe('detectGaps: ctx path ≡ v1 forward scans', () => {
  it('hits are deep-equal across 60 random + trending-gappy series', () => {
    for (let s = 0; s < 30; s++) {
      const walk = randomWalk(150, 2000 + s);
      expect(detectGaps(walk, buildScanContext(walk))).toEqual(detectGaps(walk));
      const gappy = trendingGappy(150, 3000 + s);
      const withCtx = detectGaps(gappy, buildScanContext(gappy));
      expect(withCtx).toEqual(detectGaps(gappy));
    }
  });

  it('trending gappy series actually produce open gaps (the case that mattered)', () => {
    const gappy = trendingGappy(150, 3001);
    expect(detectGaps(gappy, buildScanContext(gappy)).length).toBeGreaterThan(0);
  });
});
