import { describe, expect, it } from 'vitest';
import { detectPatterns } from '../../src/compression/patterns.js';
import type { PatternHit, PatternKind } from '../../src/compression/types.js';
import {
  abcdBullishCandles,
  batBullishCandles,
  brokenAbcdCandles,
  brokenXabcdCandles,
  gartleyBullishCandles,
  pivotPathCandles,
  randomWalkCandles,
  sidewaysCandles,
} from './fixtures.js';

const HARMONIC_KINDS: ReadonlySet<PatternKind> = new Set([
  'abcd_bullish', 'abcd_bearish', 'gartley_bullish', 'gartley_bearish', 'bat_bullish', 'bat_bearish',
]);
const harmonics = (hits: PatternHit[]): PatternHit[] => hits.filter((h) => HARMONIC_KINDS.has(h.kind));
const role = (h: PatternHit, r: string) => h.points.find((p) => p.role === r)!;

describe('detectHarmonics (via detectPatterns)', () => {
  it('bullish ABCD: exact 0.618 BC retrace + 1.4 CD extension → roles, PRZ target, invalidation', () => {
    const hits = harmonics(detectPatterns(abcdBullishCandles()));
    expect(hits).toHaveLength(1);
    const h = hits[0];
    expect(h.kind).toBe('abcd_bullish');
    expect(h.confidence).toBeGreaterThanOrEqual(0.5);
    expect(h.confidence).toBeLessThanOrEqual(0.85);

    expect(role(h, 'A').price).toBeCloseTo(110, 0);
    expect(role(h, 'B').price).toBeCloseTo(90, 0);
    expect(role(h, 'C').price).toBeCloseTo(102.36, 0);
    expect(role(h, 'D').price).toBeCloseTo(85.056, 0);

    // PRZ target = D + 0.382·CD (conservative first take-profit).
    const cd = role(h, 'C').price - role(h, 'D').price;
    expect(h.target_price!).toBeCloseTo(role(h, 'D').price + 0.382 * cd, 4);
    // Invalidation = CD stretched past the max valid extension of BC.
    expect(h.invalidation_price!).toBeLessThan(role(h, 'D').price);
  });

  it('bullish Gartley: B=0.618·XA, D=0.786·XA → xabcd roles, invalidation at X', () => {
    const hits = harmonics(detectPatterns(gartleyBullishCandles()));
    expect(hits).toHaveLength(1);
    const h = hits[0];
    expect(h.kind).toBe('gartley_bullish');

    expect(role(h, 'X').price).toBeCloseTo(80, 0);
    expect(role(h, 'A').price).toBeCloseTo(120, 0);
    expect(role(h, 'B').price).toBeCloseTo(95.28, 0);
    expect(role(h, 'D').price).toBeCloseTo(88.56, 0);
    expect(h.invalidation_price!).toBeCloseTo(80, 0); // X kills the structure
    expect(h.target_price!).toBeGreaterThan(role(h, 'D').price); // bullish PRZ
    // Near-exact ratios → confidence well above the floor.
    expect(h.confidence).toBeGreaterThan(0.75);
  });

  it('bullish Bat: B=0.45·XA (window), D=0.886·XA deep retest', () => {
    const hits = harmonics(detectPatterns(batBullishCandles()));
    expect(hits).toHaveLength(1);
    const h = hits[0];
    expect(h.kind).toBe('bat_bullish');
    expect(role(h, 'D').price).toBeCloseTo(84.56, 0);
    expect(role(h, 'D').price).toBeGreaterThan(80); // D stays inside XA
  });

  it('bearish mirror: inverted Gartley path yields gartley_bearish', () => {
    // Mirror of the bullish fixture around 100: X high, XA down, D back up.
    const hits = harmonics(detectPatterns(pivotPathCandles([120, 80, 104.72, 91.124, 111.44])));
    expect(hits).toHaveLength(1);
    expect(hits[0].kind).toBe('gartley_bearish');
    expect(hits[0].target_price!).toBeLessThan(role(hits[0], 'D').price); // bearish PRZ below D
  });

  it('NEGATIVE: BC=0.5·AB (between valid ratios) → silent discard, ZERO hits', () => {
    expect(harmonics(detectPatterns(brokenAbcdCandles()))).toHaveLength(0);
  });

  it('NEGATIVE: B=0.70·XA (dead zone between Gartley and Bat) → ZERO hits', () => {
    expect(harmonics(detectPatterns(brokenXabcdCandles()))).toHaveLength(0);
  });

  it('NEGATIVE: random walk and sideways chop → ZERO harmonic hits', () => {
    expect(harmonics(detectPatterns(randomWalkCandles()))).toHaveLength(0);
    expect(harmonics(detectPatterns(sidewaysCandles(80, 100, 1)))).toHaveLength(0);
  });

  it('family exclusivity: Gartley fixture never reports Bat and vice versa', () => {
    const g = harmonics(detectPatterns(gartleyBullishCandles())).map((h) => h.kind);
    expect(g).not.toContain('bat_bullish');
    const b = harmonics(detectPatterns(batBullishCandles())).map((h) => h.kind);
    expect(b).not.toContain('gartley_bullish');
  });
});
