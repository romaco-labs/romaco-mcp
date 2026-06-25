import { describe, expect, it } from 'vitest';
import { mapPatternToDrawings, patternGroupId } from '../../src/tools/_patternDrawings.js';
import type { PatternHit } from '../../src/compression/types.js';

const SEC = 1_700_000_000; // session-unit (seconds) base

const hs: PatternHit = {
  kind: 'head_shoulders',
  confidence: 0.8,
  points: [
    { ts: SEC + 100, price: 115, role: 'left_shoulder' },
    { ts: SEC + 300, price: 130, role: 'head' },
    { ts: SEC + 500, price: 115, role: 'right_shoulder' },
    { ts: SEC + 200, price: 95, role: 'neckline_left' },
    { ts: SEC + 400, price: 105, role: 'neckline_right' },
  ],
  target_price: 70,
  invalidation_price: 130,
};

describe('patternGroupId', () => {
  it('groups by family', () => {
    expect(patternGroupId('head_shoulders')).toBe('romaco-pattern-hs');
    expect(patternGroupId('inverse_head_shoulders')).toBe('romaco-pattern-hs');
    expect(patternGroupId('double_top')).toBe('romaco-pattern-double');
    expect(patternGroupId('ascending_triangle')).toBe('romaco-pattern-triangle');
    expect(patternGroupId('bear_flag')).toBe('romaco-pattern-flag');
  });
});

describe('mapPatternToDrawings', () => {
  it('head & shoulders → neckline trendline + 5-point silhouette path + trigger lines', () => {
    const out = mapPatternToDrawings(hs, 1000, 'romaco-pattern-hs');

    const neckline = out.find((d) => d.drawingType === 'trendline');
    expect(neckline).toBeTruthy();
    expect(neckline!.points.map((p) => p.price)).toEqual([95, 105]);

    const silhouette = out.find((d) => d.drawingType === 'path');
    expect(silhouette).toBeTruthy();
    // shoulder → neckline → head → neckline → shoulder, in order
    expect(silhouette!.points.map((p) => p.price)).toEqual([115, 95, 130, 105, 115]);

    const lines = out.filter((d) => d.drawingType === 'horizontalLine');
    expect(lines.map((l) => l.points[0].price).sort((a, b) => a - b)).toEqual([70, 130]);
    expect(lines.every((l) => (l.style?.opacity ?? 1) <= 0.4)).toBe(true);

    expect(out.every((d) => d.groupId === 'romaco-pattern-hs')).toBe(true);
  });

  it('scales timestamps by tsScale (session seconds → chart ms)', () => {
    const out = mapPatternToDrawings(hs, 1000, 'g');
    for (const d of out) {
      for (const p of d.points) {
        expect(p.timestamp).toBeGreaterThan(1e12); // ms territory
        expect(p.timestamp % 1000).toBe(0);
      }
    }
    const unscaled = mapPatternToDrawings(hs, 1, 'g');
    expect(unscaled[0].points[0].timestamp).toBe(SEC + 200);
  });

  it('double top → M silhouette path + dashed neckline at the valley', () => {
    const hit: PatternHit = {
      kind: 'double_top',
      confidence: 0.7,
      points: [
        { ts: SEC + 100, price: 120, role: 'top_1' },
        { ts: SEC + 200, price: 100, role: 'valley' },
        { ts: SEC + 300, price: 120.4, role: 'top_2' },
      ],
      target_price: 80,
      invalidation_price: 120.4,
    };
    const out = mapPatternToDrawings(hit, 1, 'romaco-pattern-double');
    const silhouette = out.find((d) => d.drawingType === 'path')!;
    expect(silhouette.points.map((p) => p.price)).toEqual([120, 100, 120.4]);
    const neckline = out.find((d) => d.label === 'double_top neckline')!;
    expect(neckline.drawingType).toBe('horizontalLine');
    expect(neckline.points[0].price).toBe(100);
    expect(neckline.style?.lineStyle).toBe('dashed');
  });

  it('triple top → 5-pivot silhouette + neckline at the FAR (lower) valley', () => {
    const hit: PatternHit = {
      kind: 'triple_top',
      confidence: 0.75,
      points: [
        { ts: SEC + 100, price: 120, role: 'top_1' },
        { ts: SEC + 200, price: 104, role: 'valley_1' },
        { ts: SEC + 300, price: 119.5, role: 'top_2' },
        { ts: SEC + 400, price: 105, role: 'valley_2' },
        { ts: SEC + 500, price: 120.2, role: 'top_3' },
      ],
      target_price: 88,
      invalidation_price: 120.2,
    };
    const out = mapPatternToDrawings(hit, 1, 'romaco-pattern-double');
    const silhouette = out.find((d) => d.drawingType === 'path')!;
    expect(silhouette.points.map((p) => p.price)).toEqual([120, 104, 119.5, 105, 120.2]);
    const neckline = out.find((d) => d.label === 'triple_top neckline')!;
    expect(neckline.points[0].price).toBe(104); // far valley, not the near one
    expect(patternGroupId('triple_bottom')).toBe('romaco-pattern-double');
  });

  it('triangle: draws only sides with >= 2 points', () => {
    const hit: PatternHit = {
      kind: 'ascending_triangle',
      confidence: 0.6,
      points: [
        { ts: SEC + 100, price: 110, role: 'high' },
        { ts: SEC + 200, price: 110.2, role: 'high' },
        { ts: SEC + 300, price: 110.1, role: 'high' },
        { ts: SEC + 400, price: 100, role: 'low' }, // single low — no lower line
      ],
    };
    const out = mapPatternToDrawings(hit, 1, 'g');
    const trendlines = out.filter((d) => d.drawingType === 'trendline');
    expect(trendlines).toHaveLength(1);
    expect(trendlines[0].label).toBe('ascending_triangle upper');
    // first → last high
    expect(trendlines[0].points.map((p) => p.price)).toEqual([110, 110.1]);
  });

  it('flag → 3-point path, no invented rectangle', () => {
    const hit: PatternHit = {
      kind: 'bull_flag',
      confidence: 0.55,
      points: [
        { ts: SEC + 100, price: 100, role: 'impulse_start' },
        { ts: SEC + 200, price: 112, role: 'impulse_end' },
        { ts: SEC + 300, price: 110, role: 'flag_end' },
      ],
      target_price: 124,
    };
    const out = mapPatternToDrawings(hit, 1, 'g');
    expect(out.find((d) => d.drawingType === 'path')!.points).toHaveLength(3);
    expect(out.some((d) => d.drawingType === 'rectangle')).toBe(false);
    expect(out.filter((d) => d.drawingType === 'horizontalLine')).toHaveLength(1); // target only
  });

  it('channel → one parallelChannel with [base_start, base_end, offset] order', () => {
    const hit: PatternHit = {
      kind: 'channel_up',
      confidence: 0.75,
      points: [
        { ts: SEC + 100, price: 100, role: 'base_start' },
        { ts: SEC + 900, price: 120, role: 'base_end' },
        { ts: SEC + 100, price: 110, role: 'offset' },
        { ts: SEC + 500, price: 111, role: 'upper_touch' },
        { ts: SEC + 700, price: 104, role: 'lower_touch' },
      ],
      target_price: 125,
      invalidation_price: 118,
    };
    const out = mapPatternToDrawings(hit, 1000, 'romaco-pattern-channel');
    const ch = out.find((d) => d.drawingType === 'parallelChannel')!;
    expect(ch).toBeTruthy();
    expect(ch.points).toEqual([
      { timestamp: (SEC + 100) * 1000, price: 100 },
      { timestamp: (SEC + 900) * 1000, price: 120 },
      { timestamp: (SEC + 100) * 1000, price: 110 },
    ]);
    // Touch evidence points are detector internals — not drawn.
    expect(out.filter((d) => d.drawingType === 'parallelChannel')).toHaveLength(1);
    expect(out.filter((d) => d.drawingType === 'horizontalLine')).toHaveLength(2); // target + invalidation
  });

  it('harmonics → native abcd/xabcd templates with ordered vertices + PRZ lines', () => {
    const gartley: PatternHit = {
      kind: 'gartley_bullish',
      confidence: 0.8,
      points: [
        { ts: SEC + 100, price: 80, role: 'X' },
        { ts: SEC + 200, price: 120, role: 'A' },
        { ts: SEC + 300, price: 95.28, role: 'B' },
        { ts: SEC + 400, price: 108.9, role: 'C' },
        { ts: SEC + 500, price: 88.56, role: 'D' },
      ],
      target_price: 100.5,
      invalidation_price: 80,
    };
    const out = mapPatternToDrawings(gartley, 1000, 'romaco-pattern-harmonic');
    const x = out.find((d) => d.drawingType === 'xabcd')!;
    expect(x).toBeTruthy();
    expect(x.points.map((p) => p.price)).toEqual([80, 120, 95.28, 108.9, 88.56]); // X,A,B,C,D order
    expect(out.filter((d) => d.drawingType === 'horizontalLine')).toHaveLength(2); // PRZ target + invalidation

    const abcd: PatternHit = {
      kind: 'abcd_bearish',
      confidence: 0.7,
      points: [
        { ts: SEC + 100, price: 90, role: 'A' },
        { ts: SEC + 200, price: 110, role: 'B' },
        { ts: SEC + 300, price: 97.6, role: 'C' },
        { ts: SEC + 400, price: 115, role: 'D' },
      ],
      target_price: 108.4,
    };
    const out2 = mapPatternToDrawings(abcd, 1, 'romaco-pattern-harmonic');
    const a = out2.find((d) => d.drawingType === 'abcd')!;
    expect(a.points.map((p) => p.price)).toEqual([90, 110, 97.6, 115]);

    expect(patternGroupId('bat_bullish')).toBe('romaco-pattern-harmonic');
  });

  it('gap → translucent rectangle over the open zone + fill-level invalidation line', () => {
    const hit: PatternHit = {
      kind: 'gap_up',
      confidence: 0.7,
      points: [
        { ts: SEC + 100, price: 100.5, role: 'gap_low' },
        { ts: SEC + 200, price: 105.5, role: 'gap_high' },
      ],
      invalidation_price: 100.5,
    };
    const out = mapPatternToDrawings(hit, 1000, 'romaco-pattern-gap');
    const rect = out.find((d) => d.drawingType === 'rectangle')!;
    expect(rect).toBeTruthy();
    expect(rect.points.map((p) => p.price)).toEqual([100.5, 105.5]);
    expect(rect.style?.fillColor).toBeTruthy();
    expect(out.some((d) => d.label === 'gap_up invalidation')).toBe(true);
    expect(out.some((d) => d.label === 'gap_up target')).toBe(false); // none invented
    expect(patternGroupId('gap_down')).toBe('romaco-pattern-gap');
    expect(patternGroupId('rounding_bottom')).toBe('romaco-pattern-cup');
  });

  it('no drawable geometry → empty (and no orphan trigger lines)', () => {
    const hit: PatternHit = {
      kind: 'symmetric_triangle',
      confidence: 0.6,
      points: [
        { ts: SEC + 100, price: 110, role: 'high' },
        { ts: SEC + 200, price: 100, role: 'low' },
      ],
      target_price: 95,
      invalidation_price: 115,
    };
    expect(mapPatternToDrawings(hit, 1, 'g')).toEqual([]);
  });
});
