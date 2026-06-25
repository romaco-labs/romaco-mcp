import { describe, expect, it } from 'vitest';
import { detectPatterns } from '../../src/compression/patterns.js';
import type { PatternHit, PatternKind } from '../../src/compression/types.js';
import {
  doubleTopCandles,
  misalignedDoubleTopCandles,
  noisyTrendCandles,
  randomWalkCandles,
  shallowDoubleTopCandles,
  sidewaysCandles,
  tripleBottomCandles,
  tripleTopCandles,
} from './fixtures.js';

const MW_KINDS: ReadonlySet<PatternKind> = new Set(['double_top', 'double_bottom', 'triple_top', 'triple_bottom']);
const mw = (hits: PatternHit[]): PatternHit[] => hits.filter((h) => MW_KINDS.has(h.kind));
const role = (h: PatternHit, r: string) => h.points.find((p) => p.role === r)!;

describe('detectDoubleTriple (via detectPatterns)', () => {
  it('double top: aligned tops, deep valley → roles, neckline-projected target', () => {
    const hits = mw(detectPatterns(doubleTopCandles(), 2));
    const dt = hits.filter((h) => h.kind === 'double_top');
    expect(dt).toHaveLength(1);
    const h = dt[0];
    expect(h.confidence).toBeGreaterThanOrEqual(0.5);
    expect(h.confidence).toBeLessThanOrEqual(0.85);

    const top1 = role(h, 'top_1');
    const valley = role(h, 'valley');
    const top2 = role(h, 'top_2');
    // Measured move: height projected below the neckline.
    const height = (top1.price + top2.price) / 2 - valley.price;
    expect(h.target_price!).toBeCloseTo(valley.price - height, 6);
    expect(h.invalidation_price!).toBeCloseTo(Math.max(top1.price, top2.price), 6);
  });

  it('triple top: 3 aligned peaks → 5 roles, neckline at the FAR valley, consumes its doubles', () => {
    const hits = mw(detectPatterns(tripleTopCandles()));
    expect(hits).toHaveLength(1); // ONE structure, one signal — no overlapping doubles
    const h = hits[0];
    expect(h.kind).toBe('triple_top');

    const roles = h.points.map((p) => p.role);
    expect(roles).toEqual(['top_1', 'valley_1', 'top_2', 'valley_2', 'top_3']);

    // Conservative neckline = lower of the two valleys (104, not 105).
    const v1 = role(h, 'valley_1').price;
    const v2 = role(h, 'valley_2').price;
    const neckline = Math.min(v1, v2);
    const peaks = (role(h, 'top_1').price + role(h, 'top_2').price + role(h, 'top_3').price) / 3;
    expect(h.target_price!).toBeCloseTo(neckline - (peaks - neckline), 6);
    // Triple structural bonus: confidence above the double floor.
    expect(h.confidence).toBeGreaterThan(0.55);
  });

  it('triple bottom mirrors with peaks/bottoms roles and upward projection', () => {
    const hits = mw(detectPatterns(tripleBottomCandles()));
    expect(hits).toHaveLength(1);
    const h = hits[0];
    expect(h.kind).toBe('triple_bottom');
    expect(h.target_price!).toBeGreaterThan(role(h, 'bottom_3').price);
    expect(h.invalidation_price!).toBeCloseTo(
      Math.min(role(h, 'bottom_1').price, role(h, 'bottom_2').price, role(h, 'bottom_3').price),
      6,
    );
  });

  it('NEGATIVE: shallow dip between aligned tops → ZERO (a pause is not a reversal)', () => {
    expect(mw(detectPatterns(shallowDoubleTopCandles()))).toHaveLength(0);
  });

  it('NEGATIVE: misaligned tops (~5% apart) → ZERO (a lower high is not a retest)', () => {
    expect(mw(detectPatterns(misalignedDoubleTopCandles()))).toHaveLength(0);
  });

  it('NEGATIVE: range chop produces ZERO M/W hits (the hallucination guard)', () => {
    expect(mw(detectPatterns(sidewaysCandles(80, 100, 1)))).toHaveLength(0);
    expect(mw(detectPatterns(randomWalkCandles()))).toHaveLength(0);
    expect(mw(detectPatterns(noisyTrendCandles()))).toHaveLength(0);
  });
});
