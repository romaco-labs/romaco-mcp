import { describe, expect, it } from 'vitest';
import { detectHarmonics } from '../../src/compression/harmonics.js';
import { buildScanContext } from '../../src/compression/scanContext.js';
import { HARMONIC_TEMPLATES } from '../../src/compression/templates/harmonic_rows.js';
import type { Candle, PatternHit, Swing } from '../../src/compression/types.js';
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
import { realCandles } from './real_fixtures.js';

/**
 * Template-port oracle — the v1 harmonics.ts detectors, VERBATIM, against the
 * template engine. Equality is asserted on full hit objects (confidence bits,
 * point roles, emission order included): any drift is a porting bug.
 */

// ── v1 oracle, copied verbatim from harmonics.ts @ commit 9b01500 ───────────
const FIB_TOL = 0.05;
const ABCD_BC_RATIOS = [0.618, 0.786];
const ABCD_CD_MIN = 1.272;
const ABCD_CD_MAX = 1.618;
const GARTLEY_B_XA = 0.618;
const GARTLEY_D_XA = 0.786;
const BAT_B_XA_MIN = 0.382;
const BAT_B_XA_MAX = 0.5;
const BAT_D_XA = 0.886;
const XABCD_C_AB_MIN = 0.382;
const XABCD_C_AB_MAX = 0.886;
const HARMONIC_MAX_SWINGS = 12;
const HARMONIC_MIN_LEG_ATR = 2;
const PRZ_TARGET_RETRACE = 0.382;

const within = (value: number, ideal: number, tol = FIB_TOL): boolean => Math.abs(value - ideal) <= tol;
const inWindow = (value: number, min: number, max: number, tol = FIB_TOL): boolean =>
  value >= min - tol && value <= max + tol;

function pt(s: Swing, role: string): PatternHit['points'][number] {
  return { ts: s.ts, price: s.price, role };
}

function detectHarmonicsV1(candles: Candle[], zz: Swing[], atr: number): PatternHit[] {
  void candles;
  if (atr <= 0) return [];
  const minLeg = HARMONIC_MIN_LEG_ATR * atr;
  const swings = zz.slice(-HARMONIC_MAX_SWINGS);
  const out: PatternHit[] = [];
  for (let i = 0; i + 3 < swings.length; i++) {
    const hit = evaluateAbcdV1(swings[i], swings[i + 1], swings[i + 2], swings[i + 3], minLeg);
    if (hit) out.push(hit);
  }
  for (let i = 0; i + 4 < swings.length; i++) {
    const hit = evaluateXabcdV1(swings[i], swings[i + 1], swings[i + 2], swings[i + 3], swings[i + 4], minLeg);
    if (hit) out.push(hit);
  }
  return out;
}

function evaluateAbcdV1(a: Swing, b: Swing, c: Swing, d: Swing, minLeg: number): PatternHit | null {
  const ab = Math.abs(b.price - a.price);
  const bc = Math.abs(c.price - b.price);
  const cd = Math.abs(d.price - c.price);
  if (ab < minLeg || bc < minLeg || cd < minLeg) return null;

  const bcRatio = bc / ab;
  const matchedBc = ABCD_BC_RATIOS.find((r) => within(bcRatio, r));
  if (matchedBc === undefined) return null;

  const cdRatio = cd / bc;
  if (!inWindow(cdRatio, ABCD_CD_MIN, ABCD_CD_MAX)) return null;

  const bullish = d.kind === 'low';
  const dir = bullish ? 1 : -1;
  const invalidation = c.price - dir * (ABCD_CD_MAX + FIB_TOL) * bc;
  const target = d.price + dir * PRZ_TARGET_RETRACE * cd;

  const confidence = Math.min(
    0.85,
    0.5 +
      0.2 * (1 - Math.abs(bcRatio - matchedBc) / FIB_TOL) +
      0.1 * (cdRatio >= ABCD_CD_MIN && cdRatio <= ABCD_CD_MAX ? 1 : 0),
  );

  return {
    kind: bullish ? 'abcd_bullish' : 'abcd_bearish',
    confidence,
    points: [pt(a, 'A'), pt(b, 'B'), pt(c, 'C'), pt(d, 'D')],
    target_price: target,
    invalidation_price: invalidation,
  };
}

function evaluateXabcdV1(x: Swing, a: Swing, b: Swing, c: Swing, d: Swing, minLeg: number): PatternHit | null {
  const xa = Math.abs(a.price - x.price);
  const ab = Math.abs(b.price - a.price);
  const bcLeg = Math.abs(c.price - b.price);
  const cdLeg = Math.abs(d.price - c.price);
  if (xa < minLeg || ab < minLeg || bcLeg < minLeg || cdLeg < minLeg) return null;

  const bullish = x.kind === 'low';
  const dir = bullish ? 1 : -1;

  if (dir * (d.price - x.price) <= 0) return null;

  const bRetrace = Math.abs(a.price - b.price) / xa;
  const cRetrace = Math.abs(c.price - b.price) / ab;
  const dRetrace = Math.abs(a.price - d.price) / xa;

  if (!inWindow(cRetrace, XABCD_C_AB_MIN, XABCD_C_AB_MAX)) return null;

  let kind: PatternHit['kind'];
  let dIdeal: number;
  if (within(bRetrace, GARTLEY_B_XA)) {
    if (!within(dRetrace, GARTLEY_D_XA)) return null;
    kind = bullish ? 'gartley_bullish' : 'gartley_bearish';
    dIdeal = GARTLEY_D_XA;
  } else if (inWindow(bRetrace, BAT_B_XA_MIN, BAT_B_XA_MAX)) {
    if (!within(dRetrace, BAT_D_XA)) return null;
    kind = bullish ? 'bat_bullish' : 'bat_bearish';
    dIdeal = BAT_D_XA;
  } else {
    return null;
  }

  const ad = Math.abs(a.price - d.price);
  const target = d.price + dir * PRZ_TARGET_RETRACE * ad;
  const invalidation = x.price;

  const bIdeal = kind.startsWith('gartley') ? GARTLEY_B_XA : (BAT_B_XA_MIN + BAT_B_XA_MAX) / 2;
  const bPrecision = kind.startsWith('gartley')
    ? 1 - Math.abs(bRetrace - bIdeal) / FIB_TOL
    : 1;
  const confidence = Math.min(
    0.85,
    0.5 + 0.15 * Math.max(0, bPrecision) + 0.2 * Math.max(0, 1 - Math.abs(dRetrace - dIdeal) / FIB_TOL),
  );

  return {
    kind,
    confidence,
    points: [pt(x, 'X'), pt(a, 'A'), pt(b, 'B'), pt(c, 'C'), pt(d, 'D')],
    target_price: target,
    invalidation_price: invalidation,
  };
}
// ── end v1 oracle ────────────────────────────────────────────────────────────

/** The kinds the v1 oracle knows. Extension rows (Butterfly/Crab) are F3b
 *  additions validated in extension_harmonics.test.ts — the parity claim here
 *  is that the v1 FAMILIES are bit-equal through the port. */
const V1_KINDS = new Set([
  'abcd_bullish',
  'abcd_bearish',
  'gartley_bullish',
  'gartley_bearish',
  'bat_bullish',
  'bat_bearish',
]);

function compare(candles: Candle[]): PatternHit[] {
  const ctx = buildScanContext(candles);
  const ported = detectHarmonics(candles, ctx.zigzag, ctx.lastAtr).filter((h) =>
    V1_KINDS.has(h.kind),
  );
  expect(ported).toEqual(detectHarmonicsV1(candles, ctx.zigzag, ctx.lastAtr));
  return ported;
}

describe('template engine ≡ v1 harmonics (oracle, bit-equal)', () => {
  it('agrees on every synthetic harmonic fixture (positive and negative)', () => {
    expect(compare(abcdBullishCandles()).map((h) => h.kind)).toContain('abcd_bullish');
    expect(compare(gartleyBullishCandles()).map((h) => h.kind)).toContain('gartley_bullish');
    expect(compare(batBullishCandles()).map((h) => h.kind)).toContain('bat_bullish');
    expect(compare(brokenAbcdCandles())).toHaveLength(0);
    expect(compare(brokenXabcdCandles())).toHaveLength(0);
    compare(pivotPathCandles([120, 80, 104.72, 91.124, 111.44])); // bearish gartley mirror
    compare(randomWalkCandles());
    compare(sidewaysCandles(80, 100, 1));
  });

  it('ABCD grid sweep: window edges, ±tol boundaries and dead zones', () => {
    // A=100 high, B=60 low (AB down 40); C = B + bc·AB; D = C − cd·BC.
    for (const bc of [0.55, 0.568, 0.6, 0.618, 0.668, 0.7, 0.736, 0.786, 0.836, 0.86]) {
      for (const cd of [1.2, 1.222, 1.272, 1.45, 1.618, 1.668, 1.7]) {
        const b = 60;
        const c = b + bc * 40;
        const d = c - cd * (c - b);
        compare(pivotPathCandles([100, b, c, d]));
      }
    }
  });

  it('XABCD grid sweep: family windows, D guard, C window', () => {
    // X=80 low, A=120 high (XA=40); B = A − b·XA; C = B + cR·AB; D = A − d·XA.
    for (const b of [0.3, 0.332, 0.382, 0.45, 0.5, 0.55, 0.568, 0.618, 0.668, 0.7]) {
      for (const d of [0.7, 0.736, 0.786, 0.836, 0.85, 0.886, 0.936, 1.05]) {
        for (const cR of [0.33, 0.5, 0.886, 0.95]) {
          const B = 120 - b * 40;
          const C = B + cR * (120 - B);
          const D = 120 - d * 40;
          compare(pivotPathCandles([80, 120, B, C, D]));
        }
      }
    }
  });

  it('agrees on 40 seeded random walks and all real fixtures', () => {
    for (let s = 0; s < 40; s++) compare(randomWalkCandles(150, 9000 + s));
    for (const sym of ['TSLA', 'XOM', 'AAPL', 'MSTR', 'SPY', 'META', 'KO', 'JPM']) {
      compare(realCandles(sym));
    }
  });
});

describe('shipped template properties', () => {
  it('XABCD full gate-sets are pairwise exclusive (no window emits two kinds)', () => {
    // Sample the (bRetrace, dRetrace) plane densely; for each point count how
    // many 5-pivot templates would pass BOTH their B and D constraints.
    const xabcd = HARMONIC_TEMPLATES.filter((t) => t.arity === 5);
    const passes = (t: (typeof xabcd)[number], name: string, v: number): boolean => {
      const spec = t.ratios.find((r) => r.name === name);
      if (!spec) return true;
      const c = spec.constraint;
      return c.kind === 'anchors'
        ? c.anchors.some((a) => Math.abs(v - a) <= c.tol)
        : v >= c.min - c.tol && v <= c.max + c.tol;
    };
    for (let b = 0.25; b <= 0.95; b += 0.005) {
      for (let d = 0.6; d <= 1.8; d += 0.005) {
        const winners = xabcd.filter((t) => passes(t, 'bRetrace', b) && passes(t, 'dRetrace', d));
        expect(winners.length).toBeLessThanOrEqual(1);
      }
    }
  });

  it('templates declare strict gates: dead-zone B (0.70·XA) fits nothing', () => {
    const ctx = buildScanContext(brokenXabcdCandles());
    expect(detectHarmonics(brokenXabcdCandles(), ctx.zigzag, ctx.lastAtr)).toHaveLength(0);
  });
});
