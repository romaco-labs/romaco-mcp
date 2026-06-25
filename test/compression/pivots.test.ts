import { describe, expect, it } from 'vitest';
import { findCandleSwings, findPivotsInSeries, minReversalFromAtr, zigzagFilter } from '../../src/compression/pivots.js';
import { findSwings } from '../../src/compression/patterns.js';
import type { Candle, Swing } from '../../src/compression/types.js';
import { headShouldersCandles, uptrendCandles } from './fixtures.js';

const swing = (index: number, price: number, kind: 'high' | 'low'): Swing => ({
  ts: 1_700_000_000 + index * 3600,
  price,
  index,
  kind,
});

describe('findPivotsInSeries', () => {
  it('finds strict local extremes with bilateral lookback', () => {
    //                     0  1  2  3   4  5  6  7   8
    const values = [5, 6, 7, 10, 7, 6, 2, 6, 7];
    const pivots = findPivotsInSeries(values, 3);
    expect(pivots).toContainEqual({ index: 3, value: 10, kind: 'high' });
    // index 6 (value 2) cannot confirm: i + lookback exceeds the series end.
    expect(pivots.filter((p) => p.kind === 'low')).toHaveLength(0);
  });

  it('ties disqualify (>= comparison)', () => {
    const values = [1, 1, 1, 5, 5, 1, 1, 1, 1];
    // index 3 and 4 both hit 5 — each sees the other in-window → neither is a high.
    expect(findPivotsInSeries(values, 3).filter((p) => p.kind === 'high')).toHaveLength(0);
  });

  it('NaN entries are neither pivots nor disqualifiers', () => {
    const values = [NaN, NaN, NaN, 4, 9, 4, 3, 2, 3];
    const pivots = findPivotsInSeries(values, 3);
    expect(pivots).toContainEqual({ index: 4, value: 9, kind: 'high' });
  });
});

/** The pre-consolidation patterns.ts implementation, kept as the parity oracle. */
function legacyFindSwings(candles: Candle[], lookback = 3): Swing[] {
  const swings: Swing[] = [];
  for (let i = lookback; i < candles.length - lookback; i++) {
    let isHigh = true;
    let isLow = true;
    for (let j = i - lookback; j <= i + lookback; j++) {
      if (j === i) continue;
      if (candles[j].high >= candles[i].high) isHigh = false;
      if (candles[j].low <= candles[i].low) isLow = false;
    }
    if (isHigh) swings.push({ ts: candles[i].timestamp, price: candles[i].high, index: i, kind: 'high' });
    if (isLow) swings.push({ ts: candles[i].timestamp, price: candles[i].low, index: i, kind: 'low' });
  }
  return swings.sort((a, b) => a.index - b.index);
}

describe('findCandleSwings — parity with the former patterns.ts findSwings', () => {
  it('identical output on the head & shoulders fixture', () => {
    const candles = headShouldersCandles();
    expect(findCandleSwings(candles, 3)).toEqual(legacyFindSwings(candles, 3));
    expect(findSwings(candles, 3)).toEqual(legacyFindSwings(candles, 3));
  });

  it('identical output on an uptrend with noise, multiple lookbacks', () => {
    const candles = uptrendCandles(120, 100, 0.5, 1.5);
    for (const lookback of [2, 3, 5]) {
      expect(findCandleSwings(candles, lookback)).toEqual(legacyFindSwings(candles, lookback));
    }
  });
});

describe('zigzagFilter', () => {
  it('output strictly alternates high/low', () => {
    const swings = [
      swing(2, 10, 'high'),
      swing(4, 11, 'high'),
      swing(6, 5, 'low'),
      swing(8, 4, 'low'),
      swing(10, 12, 'high'),
    ];
    const zz = zigzagFilter(swings, 1);
    for (let i = 1; i < zz.length; i++) {
      expect(zz[i].kind).not.toBe(zz[i - 1].kind);
    }
    // Same-kind successor replaced by the more extreme one.
    expect(zz[0]).toEqual(swing(4, 11, 'high'));
    expect(zz[1]).toEqual(swing(8, 4, 'low'));
  });

  it('rejects reversals smaller than minReversal', () => {
    const swings = [
      swing(2, 10, 'high'),
      swing(4, 9.5, 'low'), // reversal 0.5 < 2 → noise, dropped
      swing(6, 3, 'low'),   // dropped swings do not resurrect: compared vs last kept (high 10)
      swing(8, 11, 'high'),
    ];
    const zz = zigzagFilter(swings, 2);
    expect(zz.map((s) => s.index)).toEqual([2, 6, 8]);
    expect(zz[1].price).toBe(3);
  });

  it('empty input → empty output', () => {
    expect(zigzagFilter([], 1)).toEqual([]);
  });
});

describe('minReversalFromAtr', () => {
  it('uses last finite ATR scaled by mult', () => {
    const candles = uptrendCandles(60, 100, 0.5, 1);
    const base = minReversalFromAtr(candles, 1);
    expect(base).toBeGreaterThan(0);
    expect(minReversalFromAtr(candles, 2)).toBeCloseTo(base * 2, 10);
  });

  it('falls back to pct of last close on short series', () => {
    const short: Candle[] = uptrendCandles(5, 200, 1, 0);
    const lastClose = short[short.length - 1].close;
    expect(minReversalFromAtr(short, 1, 0.01)).toBeCloseTo(lastClose * 0.01, 10);
  });
});
