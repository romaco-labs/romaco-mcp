import { describe, expect, it } from 'vitest';
import { detectPatterns } from '../../src/compression/patterns.js';
import type { PatternHit, PatternKind } from '../../src/compression/types.js';
import {
  channelUpCandles,
  fallingWedgeCandles,
  noisyTrendCandles,
  randomWalkCandles,
  risingWedgeCandles,
} from './fixtures.js';

const WEDGE_KINDS: ReadonlySet<PatternKind> = new Set(['rising_wedge', 'falling_wedge']);
const CHANNEL_KINDS: ReadonlySet<PatternKind> = new Set(['channel_up', 'channel_down', 'channel_flat']);
const TRIANGLE_KINDS: ReadonlySet<PatternKind> = new Set(['ascending_triangle', 'descending_triangle', 'symmetric_triangle']);
const wedgeHits = (hits: PatternHit[]): PatternHit[] => hits.filter((h) => WEDGE_KINDS.has(h.kind));

describe('detectWedges (via detectPatterns)', () => {
  it('rising wedge: kind, confidence band, line roles, bearish resolution', () => {
    const hits = wedgeHits(detectPatterns(risingWedgeCandles()));
    expect(hits).toHaveLength(1);
    const w = hits[0];
    expect(w.kind).toBe('rising_wedge');
    expect(w.confidence).toBeGreaterThanOrEqual(0.5);
    expect(w.confidence).toBeLessThanOrEqual(0.85);

    const roles = w.points.map((p) => p.role);
    for (const r of ['upper_start', 'upper_end', 'lower_start', 'lower_end']) expect(roles).toContain(r);

    const us = w.points.find((p) => p.role === 'upper_start')!;
    const ue = w.points.find((p) => p.role === 'upper_end')!;
    const ls = w.points.find((p) => p.role === 'lower_start')!;
    const le = w.points.find((p) => p.role === 'lower_end')!;
    // Converging: the gap shrinks across the structure.
    expect(ue.price - le.price).toBeLessThan((us.price - ls.price) * 0.7 + 1e-9);
    // Bearish resolution: target at the wedge base, below the invalidation ceiling.
    expect(w.target_price!).toBeLessThan(w.invalidation_price!);
  });

  it('falling wedge mirrors: bullish resolution (target above invalidation)', () => {
    const hits = wedgeHits(detectPatterns(fallingWedgeCandles()));
    expect(hits).toHaveLength(1);
    expect(hits[0].kind).toBe('falling_wedge');
    expect(hits[0].target_price!).toBeGreaterThan(hits[0].invalidation_price!);
  });

  it('cross-exclusion: wedge fixtures fire no channel; channel fixture fires no wedge', () => {
    const rising = detectPatterns(risingWedgeCandles());
    expect(rising.filter((h) => CHANNEL_KINDS.has(h.kind))).toHaveLength(0);
    const channel = detectPatterns(channelUpCandles());
    expect(channel.filter((h) => WEDGE_KINDS.has(h.kind))).toHaveLength(0);
  });

  it('cross-exclusion: wedge fixtures fire no same-direction triangle conflict', () => {
    // Triangles need a flat line or opposite-sign slopes; a wedge has neither.
    const hits = detectPatterns(risingWedgeCandles());
    expect(hits.filter((h) => TRIANGLE_KINDS.has(h.kind))).toHaveLength(0);
  });

  it('NEGATIVE: noisy trend and random walk yield ZERO wedge hits', () => {
    expect(wedgeHits(detectPatterns(noisyTrendCandles()))).toHaveLength(0);
    expect(wedgeHits(detectPatterns(randomWalkCandles()))).toHaveLength(0);
  });
});
