import type { PatternTemplate } from './schema.js';

/**
 * Harmonic pattern rows — the v1 detectors from harmonics.ts transcribed
 * constant-for-constant into template data. The oracle tests compare this
 * port against the v1 implementations verbatim (including confidence bits
 * and emission order); any drift is a porting bug, not a recalibration.
 *
 * Level semantics worth re-stating (they differ per family):
 *   ABCD     — invalidation: CD stretched past its maximum valid extension of
 *              BC; target: 0.382 retrace of the final leg (conservative first
 *              take-profit, never the full measured move).
 *   XABCD    — retracement family (Gartley/Bat): D completes INSIDE the XA
 *              leg, so a close beyond X destroys the structure → invalidation
 *              at X. Extension families (Butterfly/Crab) complete BEYOND X
 *              and need their own invalidation construction — inv = X is
 *              definitionally impossible for them.
 */

/** Maximum deviation from an exact Fibonacci ratio. */
export const FIB_TOL = 0.05;

// ── ABCD ────────────────────────────────────────────────────────────────────
export const ABCD_BC_RATIOS = [0.618, 0.786] as const;
export const ABCD_CD_MIN = 1.272;
export const ABCD_CD_MAX = 1.618;

// ── Gartley ─────────────────────────────────────────────────────────────────
export const GARTLEY_B_XA = 0.618;
export const GARTLEY_D_XA = 0.786;

// ── Bat ─────────────────────────────────────────────────────────────────────
export const BAT_B_XA_MIN = 0.382;
export const BAT_B_XA_MAX = 0.5;
export const BAT_D_XA = 0.886;

// ── Butterfly (extension family) ────────────────────────────────────────────
export const BFLY_B_XA = 0.786;
export const BFLY_D_XA_MIN = 1.272;
export const BFLY_D_XA_MAX = 1.618;

// ── Crab (extension family) ─────────────────────────────────────────────────
export const CRAB_B_XA_MIN = 0.382;
export const CRAB_B_XA_MAX = 0.618;
export const CRAB_D_XA = 1.618; // the Crab's signature extension

// ── Shared structural windows ───────────────────────────────────────────────
export const XABCD_C_AB_MIN = 0.382;
export const XABCD_C_AB_MAX = 0.886;
export const HARMONIC_MAX_SWINGS = 12;
export const HARMONIC_MIN_LEG_ATR = 2;
export const PRZ_TARGET_RETRACE = 0.382;

/** D must stay INSIDE the XA leg — a D beyond X is definitionally not a
 *  retracement pattern. (Extension rows use dBeyondX instead.) */
const dInsideXa: NonNullable<PatternTemplate['guard']> = (w, dir) =>
  dir * (w[4].price - w[0].price) > 0;

/** Extension families complete BEYOND the X extreme. The dRetrace windows
 *  (≥ 1.222) already force |A−D| past XA; this guard pins D on the X side so
 *  a degenerate D drifting past A cannot satisfy the window by absolute
 *  value. */
const dBeyondX: NonNullable<PatternTemplate['guard']> = (w, dir) =>
  dir * (w[0].price - w[4].price) > 0;

const ABCD: PatternTemplate = {
  name: 'abcd',
  arity: 4,
  roles: ['A', 'B', 'C', 'D'],
  kindBull: 'abcd_bullish',
  kindBear: 'abcd_bearish',
  // Bullish ABCD completes on a low (AB down, CD down into the buy zone).
  bullishWhen: { point: 3, kind: 'low' },
  minLegAtr: HARMONIC_MIN_LEG_ATR,
  ratios: [
    {
      name: 'bc',
      num: [2, 1],
      den: [1, 0],
      constraint: { kind: 'anchors', anchors: ABCD_BC_RATIOS, tol: FIB_TOL },
    },
    {
      name: 'cd',
      num: [3, 2],
      den: [2, 1],
      constraint: { kind: 'window', min: ABCD_CD_MIN, max: ABCD_CD_MAX, tol: FIB_TOL },
    },
  ],
  confidence: (m) =>
    Math.min(
      0.85,
      0.5 +
        0.2 * (1 - Math.abs(m.ratios.bc - m.matchedAnchor.bc) / FIB_TOL) +
        // The bonus pays only inside the UNexpanded window; the gate is ±tol.
        0.1 * (m.ratios.cd >= ABCD_CD_MIN && m.ratios.cd <= ABCD_CD_MAX ? 1 : 0),
    ),
  target: (w, m) => w[3].price + m.dir * PRZ_TARGET_RETRACE * Math.abs(w[3].price - w[2].price),
  // Invalidation: price pushing CD past the maximum valid extension of BC.
  invalidation: (w, m) =>
    w[2].price - m.dir * (ABCD_CD_MAX + FIB_TOL) * Math.abs(w[2].price - w[1].price),
};

const xabcdShared = {
  arity: 5,
  roles: ['X', 'A', 'B', 'C', 'D'],
  // Bullish: X is a low, XA drives up, D completes back down.
  bullishWhen: { point: 0, kind: 'low' as const },
  minLegAtr: HARMONIC_MIN_LEG_ATR,
  guard: dInsideXa,
  target: (w: readonly { price: number }[], m: { dir: 1 | -1 }) =>
    w[4].price + m.dir * PRZ_TARGET_RETRACE * Math.abs(w[1].price - w[4].price),
  // A close beyond X destroys the structure.
  invalidation: (w: readonly { price: number }[]) => w[0].price,
};

const cRetraceSpec = {
  name: 'cRetrace',
  num: [3, 2],
  den: [2, 1],
  constraint: { kind: 'window', min: XABCD_C_AB_MIN, max: XABCD_C_AB_MAX, tol: FIB_TOL },
} as const;

const GARTLEY: PatternTemplate = {
  ...xabcdShared,
  name: 'gartley',
  kindBull: 'gartley_bullish',
  kindBear: 'gartley_bearish',
  ratios: [
    cRetraceSpec,
    {
      name: 'bRetrace',
      num: [1, 2],
      den: [0, 1],
      constraint: { kind: 'anchors', anchors: [GARTLEY_B_XA], tol: FIB_TOL },
    },
    {
      name: 'dRetrace',
      num: [1, 4],
      den: [0, 1],
      constraint: { kind: 'anchors', anchors: [GARTLEY_D_XA], tol: FIB_TOL },
    },
  ],
  confidence: (m) => {
    const bPrecision = 1 - Math.abs(m.ratios.bRetrace - GARTLEY_B_XA) / FIB_TOL;
    return Math.min(
      0.85,
      0.5 +
        0.15 * Math.max(0, bPrecision) +
        0.2 * Math.max(0, 1 - Math.abs(m.ratios.dRetrace - GARTLEY_D_XA) / FIB_TOL),
    );
  },
};

const BAT: PatternTemplate = {
  ...xabcdShared,
  name: 'bat',
  kindBull: 'bat_bullish',
  kindBear: 'bat_bearish',
  ratios: [
    cRetraceSpec,
    {
      name: 'bRetrace',
      num: [1, 2],
      den: [0, 1],
      // v1 inWindow with default tol: the effective gate is [0.332, 0.55] —
      // still disjoint from Gartley's [0.568, 0.668] anchor window.
      constraint: { kind: 'window', min: BAT_B_XA_MIN, max: BAT_B_XA_MAX, tol: FIB_TOL },
    },
    {
      name: 'dRetrace',
      num: [1, 4],
      den: [0, 1],
      constraint: { kind: 'anchors', anchors: [BAT_D_XA], tol: FIB_TOL },
    },
  ],
  // Bat's B is a window, not a point — precision lives in D (bPrecision ≡ 1).
  confidence: (m) =>
    Math.min(
      0.85,
      0.5 + 0.15 * Math.max(0, 1) + 0.2 * Math.max(0, 1 - Math.abs(m.ratios.dRetrace - BAT_D_XA) / FIB_TOL),
    ),
};

const BUTTERFLY: PatternTemplate = {
  ...xabcdShared,
  name: 'butterfly',
  kindBull: 'butterfly_bullish',
  kindBear: 'butterfly_bearish',
  guard: dBeyondX,
  ratios: [
    cRetraceSpec,
    {
      name: 'bRetrace',
      num: [1, 2],
      den: [0, 1],
      constraint: { kind: 'anchors', anchors: [BFLY_B_XA], tol: FIB_TOL },
    },
    {
      name: 'dRetrace',
      num: [1, 4],
      den: [0, 1],
      constraint: { kind: 'window', min: BFLY_D_XA_MIN, max: BFLY_D_XA_MAX, tol: FIB_TOL },
    },
  ],
  confidence: (m) => {
    const bPrecision = 1 - Math.abs(m.ratios.bRetrace - BFLY_B_XA) / FIB_TOL;
    return Math.min(
      0.85,
      0.5 +
        0.15 * Math.max(0, bPrecision) +
        // Window D: the bonus pays inside the unexpanded window (ABCD's cd
        // convention), since a window has no single ideal to grade against.
        0.1 * (m.ratios.dRetrace >= BFLY_D_XA_MIN && m.ratios.dRetrace <= BFLY_D_XA_MAX ? 1 : 0),
    );
  },
  // Extension exhaustion (mirrors ABCD's construction): price stretching past
  // the deepest valid D extension destroys the pattern. inv = X is impossible
  // here — price is already beyond X when the pattern completes.
  invalidation: (w, m) =>
    w[1].price - m.dir * (BFLY_D_XA_MAX + FIB_TOL) * Math.abs(w[1].price - w[0].price),
};

const CRAB: PatternTemplate = {
  ...xabcdShared,
  name: 'crab',
  kindBull: 'crab_bullish',
  kindBear: 'crab_bearish',
  guard: dBeyondX,
  ratios: [
    cRetraceSpec,
    {
      name: 'bRetrace',
      num: [1, 2],
      den: [0, 1],
      // Overlaps Bat's B window and Gartley's B anchor — full gate-sets stay
      // pairwise exclusive via D (≈1.618·XA vs ≤0.936·XA); the property test
      // in template_parity pins that.
      constraint: { kind: 'window', min: CRAB_B_XA_MIN, max: CRAB_B_XA_MAX, tol: FIB_TOL },
    },
    {
      name: 'dRetrace',
      num: [1, 4],
      den: [0, 1],
      constraint: { kind: 'anchors', anchors: [CRAB_D_XA], tol: FIB_TOL },
    },
  ],
  // Crab's B is a window — precision lives in the 1.618 D anchor (Bat's
  // convention).
  confidence: (m) =>
    Math.min(
      0.85,
      0.5 + 0.15 * Math.max(0, 1) + 0.2 * Math.max(0, 1 - Math.abs(m.ratios.dRetrace - CRAB_D_XA) / FIB_TOL),
    ),
  invalidation: (w, m) =>
    w[1].price - m.dir * (CRAB_D_XA + FIB_TOL) * Math.abs(w[1].price - w[0].price),
};

/** Declared order = emission order within a window (engine contract). */
export const HARMONIC_TEMPLATES: readonly PatternTemplate[] = [ABCD, GARTLEY, BAT, BUTTERFLY, CRAB];
