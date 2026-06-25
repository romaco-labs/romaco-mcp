import { describe, expect, it } from 'vitest';
import { breachedSinceCompletion, detectPatterns } from '../../src/compression/patterns.js';
import type { Candle, PatternHit } from '../../src/compression/types.js';
import { doubleTopCandles, gartleyBullishCandles } from './fixtures.js';

/**
 * Historical Breach Guard — the anti-zombie filter.
 *
 * The motivating real case: TSLA daily iH&S (conf 0.88, invalidation 381.40)
 * completed 2026-03-13; price traded 378.73 six days later, crashed to 330,
 * then recovered to 399. lastClose-only liveness saw 399 > 381.40 and called
 * the pattern live — a trade stopped out weeks earlier. The guard scans every
 * candle between pattern completion and now: any touch of the invalidation
 * level or the target means the setup is consumed.
 */

const T0 = 1_700_000_000;
const STEP = 3600;

function bar(i: number, close: number, opts: { high?: number; low?: number } = {}): Candle {
  return {
    timestamp: T0 + i * STEP,
    open: close,
    high: opts.high ?? close + 0.5,
    low: opts.low ?? close - 0.5,
    close,
    volume: 1000,
  };
}

/** A hit completing at bar 4 (its rightmost structural anchor). */
function hitAt4(levels: { target_price?: number; invalidation_price?: number }): PatternHit {
  return {
    kind: 'double_top',
    confidence: 0.7,
    points: [
      { ts: T0 + 1 * STEP, price: 101, role: 'top_1' },
      { ts: T0 + 4 * STEP, price: 100, role: 'top_2' },
    ],
    ...levels,
  };
}

/** Ten flat bars at 100; callers override individual bars to inject excursions. */
function flatCandles(): Candle[] {
  return Array.from({ length: 10 }, (_, i) => bar(i, 100));
}

/** Append closes to a fixture, continuing its timestamp spacing. */
function extend(base: Candle[], closes: number[]): Candle[] {
  const step = base[1].timestamp - base[0].timestamp;
  let t = base[base.length - 1].timestamp;
  let prev = base[base.length - 1].close;
  const out = [...base];
  for (const close of closes) {
    t += step;
    const open = (prev + close) / 2;
    out.push({
      timestamp: t,
      open,
      high: Math.max(open, close) + 0.15,
      low: Math.min(open, close) - 0.15,
      close,
      volume: 1000,
    });
    prev = close;
  }
  return out;
}

describe('breachedSinceCompletion (unit)', () => {
  it('kills on invalidation breach below (floor side, wick touch counts)', () => {
    const candles = flatCandles();
    candles[6] = bar(6, 96, { low: 94.9 }); // inv 95 < ref → floor; low 94.9 <= 95
    expect(breachedSinceCompletion(hitAt4({ invalidation_price: 95 }), candles)).toBe(true);
  });

  it('kills on invalidation breach above (ceiling side)', () => {
    const candles = flatCandles();
    candles[7] = bar(7, 104, { high: 105.2 }); // inv 105 > ref → ceiling; high 105.2 >= 105
    expect(breachedSinceCompletion(hitAt4({ invalidation_price: 105 }), candles)).toBe(true);
  });

  it('kills when the target above was tagged — exact touch consumes', () => {
    const candles = flatCandles();
    candles[6] = bar(6, 103, { high: 104 }); // tgt 104, high == 104 → a parked limit fills
    expect(breachedSinceCompletion(hitAt4({ target_price: 104 }), candles)).toBe(true);
  });

  it('kills when the target below was tagged', () => {
    const candles = flatCandles();
    candles[8] = bar(8, 97, { low: 95.9 }); // tgt 96 < ref → low 95.9 <= 96
    expect(breachedSinceCompletion(hitAt4({ target_price: 96 }), candles)).toBe(true);
  });

  it('ignores excursions BEFORE the pattern completed', () => {
    const candles = flatCandles();
    candles[2] = bar(2, 94, { low: 93 }); // way below inv 95, but pre-completion
    expect(
      breachedSinceCompletion(hitAt4({ invalidation_price: 95, target_price: 110 }), candles),
    ).toBe(false);
  });

  it('clean span after completion → pattern stays live', () => {
    expect(
      breachedSinceCompletion(hitAt4({ invalidation_price: 95, target_price: 110 }), flatCandles()),
    ).toBe(false);
  });

  it('no levels / completion on the last bar → nothing to scan, stays live', () => {
    expect(breachedSinceCompletion(hitAt4({}), flatCandles())).toBe(false);
    const lastBarHit: PatternHit = {
      ...hitAt4({ invalidation_price: 95 }),
      points: [{ ts: T0 + 9 * STEP, price: 100, role: 'top_2' }],
    };
    expect(breachedSinceCompletion(lastBarHit, flatCandles())).toBe(false);
  });
});

describe('zombie patterns (via detectPatterns)', () => {
  it('control: the in-formation double top fires (it is genuinely live)', () => {
    const hits = detectPatterns(doubleTopCandles()).filter((h) => h.kind === 'double_top');
    expect(hits).toHaveLength(1);
  });

  it('ZOMBIE double top: target tagged then price re-entered the band → ZERO', () => {
    // doubleTopCandles → tops 120.5, neckline 99.5, target 78.5, inv 120.5.
    // Excursion dives through the neckline TO the target (low 78.45 ≤ 78.5)
    // and recovers to 112 — strictly inside the (neckline, invalidation) band,
    // so the lastClose-only liveness check would happily report the M as live.
    // Only the breach guard knows the measured move already paid out.
    const zombie = extend(doubleTopCandles(), [105, 95, 85, 78.6, 90, 102, 110, 112, 111, 112]);
    const last = zombie[zombie.length - 1].close;
    expect(last).toBeGreaterThan(99.5); // documents: still inside the band…
    expect(last).toBeLessThan(120.5); // …i.e. stillInPlay alone would pass
    expect(detectPatterns(zombie).filter((h) => h.kind === 'double_top')).toHaveLength(0);
  });

  it('ZOMBIE harmonic: X breached after D completed → ZERO gartley', () => {
    // After D (88.56), a confirmed lower-high pivot at ~97, then a dive through
    // X = 80 (low 79.35), then recovery. The XABCD geometry still sits intact
    // in the zigzag — only the breach guard knows the structure was destroyed.
    const zombie = extend(gartleyBullishCandles(), [95, 97, 95.5, 94, 88, 83, 79.5, 84, 86, 85.5]);
    expect(detectPatterns(zombie).filter((h) => h.kind === 'gartley_bullish')).toHaveLength(0);
  });
});
