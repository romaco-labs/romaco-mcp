import { describe, expect, it } from 'vitest';
import { detectPatterns } from '../../src/compression/patterns.js';
import type { PatternHit, PatternKind } from '../../src/compression/types.js';
import {
  channelDownCandles,
  channelUpCandles,
  flatRangeCandles,
  noisyTrendCandles,
  randomWalkCandles,
  sidewaysCandles,
} from './fixtures.js';

const CHANNEL_KINDS: ReadonlySet<PatternKind> = new Set(['channel_up', 'channel_down', 'channel_flat']);
const channelHits = (hits: PatternHit[]): PatternHit[] => hits.filter((h) => CHANNEL_KINDS.has(h.kind));

describe('detectChannels (via detectPatterns)', () => {
  it('ascending channel: kind, confidence band, roles, honest target/invalidation', () => {
    const hits = channelHits(detectPatterns(channelUpCandles()));
    expect(hits).toHaveLength(1);
    const ch = hits[0];
    expect(ch.kind).toBe('channel_up');
    expect(ch.confidence).toBeGreaterThanOrEqual(0.5);
    expect(ch.confidence).toBeLessThanOrEqual(0.85);

    const roles = ch.points.map((p) => p.role);
    expect(roles).toContain('base_start');
    expect(roles).toContain('base_end');
    expect(roles).toContain('offset');
    expect(roles.filter((r) => r === 'upper_touch' || r === 'lower_touch').length).toBeGreaterThanOrEqual(4);

    // Up-channel: base = LOWER line, offset = upper line at the same ts → offset above base_start.
    const baseStart = ch.points.find((p) => p.role === 'base_start')!;
    const offset = ch.points.find((p) => p.role === 'offset')!;
    expect(offset.ts).toBe(baseStart.ts);
    expect(offset.price).toBeGreaterThan(baseStart.price);

    // Honest projection: ride to the upper band, die on the lower — target above invalidation.
    expect(ch.target_price!).toBeGreaterThan(ch.invalidation_price!);

    // Recency contract: the most recent point sits in the final quarter of the series.
    const candles = channelUpCandles();
    const lastTs = candles[candles.length - 1].timestamp;
    const firstTs = candles[0].timestamp;
    const latest = Math.max(...ch.points.map((p) => p.ts));
    expect(latest).toBeGreaterThanOrEqual(lastTs - 0.25 * (lastTs - firstTs));
  });

  it('descending channel mirrors: base = upper line, target below invalidation', () => {
    const hits = channelHits(detectPatterns(channelDownCandles()));
    expect(hits).toHaveLength(1);
    const ch = hits[0];
    expect(ch.kind).toBe('channel_down');
    const baseStart = ch.points.find((p) => p.role === 'base_start')!;
    const offset = ch.points.find((p) => p.role === 'offset')!;
    expect(offset.price).toBeLessThan(baseStart.price); // base = upper, offset = lower
    expect(ch.target_price!).toBeLessThan(ch.invalidation_price!);
  });

  it('flat range classifies as channel_flat', () => {
    const hits = channelHits(detectPatterns(flatRangeCandles()));
    expect(hits).toHaveLength(1);
    expect(hits[0].kind).toBe('channel_flat');
  });

  it('NEGATIVE: containment-breaking noisy trend yields ZERO channel hits', () => {
    expect(channelHits(detectPatterns(noisyTrendCandles()))).toHaveLength(0);
  });

  it('NEGATIVE: random walk yields ZERO channel hits', () => {
    expect(channelHits(detectPatterns(randomWalkCandles()))).toHaveLength(0);
  });

  it('NEGATIVE: small sideways chop (sub-ATR oscillation) yields ZERO channel hits', () => {
    expect(channelHits(detectPatterns(sidewaysCandles(80, 100, 1)))).toHaveLength(0);
  });
});
