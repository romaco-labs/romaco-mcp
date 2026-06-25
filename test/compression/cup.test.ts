import { describe, expect, it } from 'vitest';
import { detectPatterns } from '../../src/compression/patterns.js';
import type { PatternHit } from '../../src/compression/types.js';
import {
  cupHandleCandles,
  cupNoHandleCandles,
  randomWalkCandles,
  vBottomCandles,
} from './fixtures.js';

const cupHits = (hits: PatternHit[]): PatternHit[] => hits.filter((h) => h.kind === 'cup_handle');

describe('detectCupHandle (via detectPatterns)', () => {
  it('clean cup & handle: roles, measured-move target, handle-low invalidation', () => {
    const candles = cupHandleCandles();
    const hits = cupHits(detectPatterns(candles));
    expect(hits).toHaveLength(1);
    const cup = hits[0];
    expect(cup.confidence).toBeGreaterThanOrEqual(0.5);
    expect(cup.confidence).toBeLessThanOrEqual(0.85);

    const roles = cup.points.map((p) => p.role);
    for (const r of ['left_rim', 'cup_bottom', 'right_rim', 'handle_low', 'handle_end']) {
      expect(roles).toContain(r);
    }
    expect(roles.filter((r) => r === 'arc')).toHaveLength(7);

    const leftRim = cup.points.find((p) => p.role === 'left_rim')!;
    const rightRim = cup.points.find((p) => p.role === 'right_rim')!;
    const bottom = cup.points.find((p) => p.role === 'cup_bottom')!;
    const handleLow = cup.points.find((p) => p.role === 'handle_low')!;

    // Measured move: target = rim + depth, exact arithmetic.
    const rim = (leftRim.price + rightRim.price) / 2;
    const depth = rim - bottom.price;
    expect(cup.target_price!).toBeCloseTo(rim + depth, 6);
    expect(cup.invalidation_price!).toBeCloseTo(handleLow.price, 6);

    // Handle stays shallow (≤ half the cup depth).
    expect(rim - handleLow.price).toBeLessThanOrEqual(0.5 * depth + 1e-9);

    // The arc descends then ascends (a bowl, not a slope).
    const arc = cup.points.filter((p) => p.role === 'arc').map((p) => p.price);
    const minAt = arc.indexOf(Math.min(...arc));
    expect(minAt).toBeGreaterThan(0);
    expect(minAt).toBeLessThan(arc.length - 1);
    for (let i = 1; i <= minAt; i++) expect(arc[i]).toBeLessThanOrEqual(arc[i - 1] + 1e-9);
    for (let i = minAt + 1; i < arc.length; i++) expect(arc[i]).toBeGreaterThanOrEqual(arc[i - 1] - 1e-9);

    // Recency contract: handle_end is the last candle.
    const lastTs = candles[candles.length - 1].timestamp;
    expect(Math.max(...cup.points.map((p) => p.ts))).toBe(lastTs);
  });

  it('NEGATIVE: a sharp V-bottom of similar depth must NOT fire (basin gate)', () => {
    expect(cupHits(detectPatterns(vBottomCandles()))).toHaveLength(0);
  });

  it('NEGATIVE: a perfect cup WITHOUT a handle must NOT fire (unfinished = no pattern)', () => {
    expect(cupHits(detectPatterns(cupNoHandleCandles()))).toHaveLength(0);
  });

  it('NEGATIVE: random walk yields ZERO cup hits', () => {
    expect(cupHits(detectPatterns(randomWalkCandles()))).toHaveLength(0);
  });
});
