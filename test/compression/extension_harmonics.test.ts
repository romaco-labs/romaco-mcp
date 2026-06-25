import { describe, expect, it } from 'vitest';
import { detectHarmonics } from '../../src/compression/harmonics.js';
import { detectPatterns } from '../../src/compression/patterns.js';
import { buildScanContext } from '../../src/compression/scanContext.js';
import { detectTemplates } from '../../src/compression/templates/engine.js';
import { HARMONIC_TEMPLATES } from '../../src/compression/templates/harmonic_rows.js';
import type { Candle, PatternKind, Swing } from '../../src/compression/types.js';
import { pivotPathCandles } from './fixtures.js';
import { realCandles } from './real_fixtures.js';

/**
 * Butterfly & Crab — the extension XABCD families, added as template ROWS
 * (the point of the template engine: pattern N+1 is data + calibration, not a
 * module).
 *
 * Extension semantics: D completes BEYOND X, so the retracement families'
 * invalidation (a close beyond X) is definitionally impossible here. Their
 * invalidation mirrors ABCD's construction instead: price stretching past the
 * deepest valid D extension (max window + tol of XA) destroys the pattern.
 *
 * Honest-signal gate for the new rows: strict harmonics are RARE on real
 * data (v1 found one Bat across 17 combos) — the real-fixture sweep below
 * freezes the observed count, and any future hit lands in the goldens where
 * it gets reviewed, not silently shipped.
 */

const harmonic5 = (candles: Candle[], kinds: PatternKind[]): ReturnType<typeof detectHarmonics> => {
  const ctx = buildScanContext(candles);
  return detectHarmonics(candles, ctx.zigzag, ctx.lastAtr).filter((h) => kinds.includes(h.kind));
};

describe('Butterfly (B=0.786·XA, D extends 1.272–1.618·XA)', () => {
  // X=80, A=120 (XA=40): B=88.56, C=104.28, D=120−1.45·40=62 < X.
  // (D mid-window: the fixture's wick offsets shift effective ratios by
  // ~±0.002, so a D parked exactly on the 1.272 window edge would flap the
  // confidence bonus.)
  const path = [80, 120, 88.56, 104.28, 62];

  it('bullish: exact path fires with extension levels', () => {
    const hits = harmonic5(pivotPathCandles(path), ['butterfly_bullish']);
    expect(hits).toHaveLength(1);
    const h = hits[0];
    expect(h.points.map((p) => p.role)).toEqual(['X', 'A', 'B', 'C', 'D']);
    // The zigzag pivots carry the fixture's wick offsets, so assert the level
    // FORMULAS against the hit's own anchor points (that is the design under
    // test), not the nominal path prices.
    const [X, A, , , D] = h.points.map((p) => p.price);
    expect(h.target_price).toBeCloseTo(D + 0.382 * (A - D), 10);
    // Invalidation: extension exhaustion A − (1.618+0.05)·XA — NOT X.
    expect(h.invalidation_price).toBeCloseTo(A - 1.668 * (A - X), 10);
    expect(h.invalidation_price).toBeLessThan(X);
    expect(h.confidence).toBeGreaterThan(0.7); // B at its anchor, D inside the window
    expect(h.confidence).toBeLessThanOrEqual(0.85);
  });

  it('bearish mirror fires', () => {
    const mirror = [120, 80, 111.44, 95.72, 130.88];
    expect(harmonic5(pivotPathCandles(mirror), ['butterfly_bearish'])).toHaveLength(1);
  });

  it('D short of the extension window (1.15·XA) → nothing', () => {
    const shallow = [80, 120, 88.56, 104.28, 120 - 1.15 * 40];
    expect(harmonic5(pivotPathCandles(shallow), ['butterfly_bullish', 'crab_bullish'])).toHaveLength(0);
  });
});

describe('Crab (B in 0.382–0.618·XA, D=1.618·XA — the signature extension)', () => {
  // X=80, A=120: B=100, C=110, D=120−1.618·40=55.28.
  const path = [80, 120, 100, 110, 55.28];

  it('bullish: exact path fires; D at the 1.618 anchor grades near the cap', () => {
    const hits = harmonic5(pivotPathCandles(path), ['crab_bullish']);
    expect(hits).toHaveLength(1);
    const h = hits[0];
    const [X, A, , , D] = h.points.map((p) => p.price);
    const dRetrace = Math.abs(A - D) / Math.abs(A - X);
    expect(h.confidence).toBeCloseTo(
      Math.min(0.85, 0.5 + 0.15 + 0.2 * Math.max(0, 1 - Math.abs(dRetrace - 1.618) / 0.05)),
      10,
    );
    expect(h.confidence).toBeGreaterThan(0.8);
    expect(h.target_price).toBeCloseTo(D + 0.382 * (A - D), 10);
    expect(h.invalidation_price).toBeCloseTo(A - 1.668 * (A - X), 10);
  });

  it('dead zone between Butterfly window and Crab anchor (D=1.5 with Crab B) → nothing', () => {
    // B=0.5·XA excludes Butterfly (B anchor 0.786); D=1.5 misses Crab's
    // 1.618±0.05 anchor → the combination fits no family.
    const dead = [80, 120, 100, 110, 120 - 1.5 * 40];
    expect(
      harmonic5(pivotPathCandles(dead), [
        'butterfly_bullish',
        'crab_bullish',
        'gartley_bullish',
        'bat_bullish',
      ]),
    ).toHaveLength(0);
  });
});

describe('dBeyondX guard', () => {
  it('rejects a degenerate D drifting past A (|A−D| in window by absolute value)', () => {
    // Fabricated zigzag: D "low" at 170, ABOVE A=120 — |A−D|/XA = 1.25 sits in
    // Butterfly's window, every leg clears the ATR gate, alternation holds.
    // Only the guard knows the extension ran the wrong way.
    const mk = (i: number, price: number, kind: 'high' | 'low'): Swing => ({
      ts: 1_700_000_000 + i * 3600,
      price,
      index: i,
      kind,
    });
    const zz = [
      mk(0, 80, 'low'),
      mk(6, 120, 'high'),
      mk(12, 88.56, 'low'),
      mk(18, 104.28, 'high'),
      mk(24, 170, 'low'),
    ];
    const butterfly = HARMONIC_TEMPLATES.filter((t) => t.name === 'butterfly');
    expect(detectTemplates(zz, 2, butterfly)).toHaveLength(0);
    // Sanity: the same window with D correctly beyond X fires.
    const ok = [...zz.slice(0, 4), mk(24, 69.12, 'low')];
    expect(detectTemplates(ok, 2, butterfly)).toHaveLength(1);
  });
});

describe('real-data honesty sweep', () => {
  it('extension harmonics stay rare: observed count on the 8 recorded fixtures is frozen', () => {
    let hits = 0;
    for (const sym of ['TSLA', 'XOM', 'AAPL', 'MSTR', 'SPY', 'META', 'KO', 'JPM']) {
      hits += detectPatterns(realCandles(sym)).filter((h) =>
        ['butterfly_bullish', 'butterfly_bearish', 'crab_bullish', 'crab_bearish'].includes(h.kind),
      ).length;
    }
    // Strict gates → expect zero on this snapshot. If a future re-record
    // surfaces one, it must be reviewed by hand and this number moved
    // deliberately together with the goldens.
    expect(hits).toBe(0);
  });
});
