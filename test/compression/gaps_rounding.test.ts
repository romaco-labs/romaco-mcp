import { describe, expect, it } from 'vitest';
import { detectPatterns } from '../../src/compression/patterns.js';
import type { PatternHit, PatternKind } from '../../src/compression/types.js';
import {
  cupHandleCandles,
  fallingParabolaCandles,
  gapFilledCandles,
  gapUpCandles,
  microGapCandles,
  randomWalkCandles,
  roundingBottomCandles,
  sidewaysCandles,
  vBottomCandles,
} from './fixtures.js';

const only = (hits: PatternHit[], ...kinds: PatternKind[]): PatternHit[] =>
  hits.filter((h) => kinds.includes(h.kind));
const role = (h: PatternHit, r: string) => h.points.find((p) => p.role === r)!;

describe('detectRoundingBottom (via detectPatterns)', () => {
  it('parabolic basin without a handle: arc roles, rim target, bottom invalidation', () => {
    const hits = only(detectPatterns(roundingBottomCandles()), 'rounding_bottom');
    expect(hits).toHaveLength(1);
    const h = hits[0];
    expect(h.confidence).toBeGreaterThanOrEqual(0.5);
    expect(h.confidence).toBeLessThanOrEqual(0.85);

    const roles = h.points.map((p) => p.role);
    for (const r of ['rim_left', 'bottom', 'recovery_end']) expect(roles).toContain(r);
    expect(roles.filter((r) => r === 'arc')).toHaveLength(7);

    // Fitted vertex sits near the theoretical bottom (lead/tail bars skew it slightly).
    const bottom = role(h, 'bottom').price;
    expect(bottom).toBeGreaterThan(98);
    expect(bottom).toBeLessThan(103);
    // Measured move: rim + depth, with rim ≈ 120 and depth ≈ 20 → ≈ 140.
    expect(h.target_price!).toBeGreaterThan(130);
    expect(h.invalidation_price!).toBeCloseTo(bottom, 6);

    // The bowl: arc descends then ascends.
    const arc = h.points.filter((p) => p.role === 'arc').map((p) => p.price);
    const minAt = arc.indexOf(Math.min(...arc));
    expect(minAt).toBeGreaterThan(0);
    expect(minAt).toBeLessThan(arc.length - 1);
  });

  it('cup & handle SUPPRESSES rounding bottom — one structure, one signal', () => {
    const hits = detectPatterns(cupHandleCandles());
    expect(only(hits, 'cup_handle')).toHaveLength(1);
    expect(only(hits, 'rounding_bottom')).toHaveLength(0);
  });

  it('NEGATIVE: V-bottom must NOT fire (basin gate)', () => {
    expect(only(detectPatterns(vBottomCandles()), 'rounding_bottom')).toHaveLength(0);
  });

  it('NEGATIVE: still-falling parabola (vertex at the end, no recovery) → ZERO', () => {
    expect(only(detectPatterns(fallingParabolaCandles()), 'rounding_bottom')).toHaveLength(0);
  });

  it('NEGATIVE: random walk and sideways chop → ZERO rounding bottoms', () => {
    expect(only(detectPatterns(randomWalkCandles()), 'rounding_bottom')).toHaveLength(0);
    expect(only(detectPatterns(sidewaysCandles(80, 100, 1)), 'rounding_bottom')).toHaveLength(0);
  });
});

describe('detectGaps (via detectPatterns)', () => {
  it('unfilled breakaway gap up: zone roles, fill level as invalidation, NO invented target', () => {
    const hits = only(detectPatterns(gapUpCandles()), 'gap_up', 'gap_down');
    expect(hits).toHaveLength(1);
    const h = hits[0];
    expect(h.kind).toBe('gap_up');
    expect(h.confidence).toBeGreaterThanOrEqual(0.5);
    expect(h.confidence).toBeLessThanOrEqual(0.85);

    const lo = role(h, 'gap_low');
    const hi = role(h, 'gap_high');
    expect(hi.price).toBeGreaterThan(lo.price);
    // gap_low = the pre-gap high (the fill level → invalidation).
    expect(h.invalidation_price!).toBeCloseTo(lo.price, 6);
    // A gap is momentum context, not a measured-move setup.
    expect(h.target_price).toBeUndefined();
  });

  it('NEGATIVE: a later-filled gap is consumed — ZERO hits', () => {
    expect(only(detectPatterns(gapFilledCandles()), 'gap_up', 'gap_down')).toHaveLength(0);
  });

  it('NEGATIVE: sub-ATR micro-gaps are noise — ZERO hits', () => {
    expect(only(detectPatterns(microGapCandles()), 'gap_up', 'gap_down')).toHaveLength(0);
  });

  it('NEGATIVE: contiguous random walk produces ZERO gaps', () => {
    expect(only(detectPatterns(randomWalkCandles()), 'gap_up', 'gap_down')).toHaveLength(0);
  });
});
