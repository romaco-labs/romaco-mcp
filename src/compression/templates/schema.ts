import type { PatternKind, Swing } from '../types.js';

/**
 * Declarative pattern templates — pivot-sequence patterns as DATA.
 *
 * A template describes a k-pivot structure as ratio constraints between point
 * pairs, plus closures for the parts that must stay bit-exact (confidence
 * formulas, target/invalidation levels). Adding a new ratio-defined pattern
 * is a new row in a table plus its real-data calibration — not a new module.
 *
 * Deliberate split between data and code:
 *   - DATA drives the generic matcher: arity, leg gate, ratio gates with
 *     anchors-vs-window semantics, direction rule.
 *   - CLOSURES own confidence and levels: these are calibrated formulas the
 *     honest-signal law freezes; a declarative confidence DSL would only
 *     create places for porting errors to hide.
 *
 * Scope: this engine is for RATIO-defined patterns (harmonics family).
 * Doubles/H&S/triangles stay native — their gates couple to price levels
 * (lastClose liveness bands, triple-consumes-double suppression) and a
 * different pivot substrate (raw swings), so forcing them into shape-ratio
 * space buys nothing and risks calibrated behavior.
 */

export type RatioConstraint =
  /**
   * |value − a| ≤ tol for SOME anchor a. The matched anchor is recorded and
   * fed to the confidence closure. This is NOT a [min,max] window: anchors
   * {0.618, 0.786} ± 0.05 leave a dead zone (~0.67–0.74) that must keep
   * rejecting — collapsing them to one window would admit it.
   */
  | { kind: 'anchors'; anchors: readonly number[]; tol: number }
  /**
   * min − tol ≤ value ≤ max + tol (the GATE window). The raw [min, max] stays
   * available to confidence closures — e.g. ABCD's cd bonus pays only inside
   * the unexpanded window while the gate accepts ± tol around it.
   */
  | { kind: 'window'; min: number; max: number; tol: number };

export interface RatioSpec {
  /** Key under which the ratio (and matched anchor) lands in MatchResult. */
  name: string;
  /** Ratio numerator: |points[i].price − points[j].price|. */
  num: readonly [number, number];
  /** Ratio denominator: same point-pair form. Pairs are NOT restricted to
   *  consecutive legs — Gartley's dRetrace is |A−D| / |X−A|. */
  den: readonly [number, number];
  constraint: RatioConstraint;
}

export interface MatchResult {
  /** Every declared ratio by name, in template order. */
  ratios: Record<string, number>;
  /** For anchors constraints: the anchor that matched. */
  matchedAnchor: Record<string, number>;
  /** +1 bullish / −1 bearish, from the template's direction rule. */
  dir: 1 | -1;
  /** The ATR the leg gate used (for closures that need scale). */
  atr: number;
}

export interface PatternTemplate {
  /** Human/test identifier — never emitted in hits. */
  name: string;
  /** Number of consecutive zigzag pivots the template consumes. */
  arity: number;
  /** Role labels for the emitted points, by window position. */
  roles: readonly string[];
  kindBull: PatternKind;
  kindBear: PatternKind;
  /** The structure is bullish when window[point].kind === kind (zigzag
   *  alternation makes the opposite case the bearish mirror). */
  bullishWhen: { point: number; kind: 'high' | 'low' };
  /** Every consecutive leg must travel at least this many ATRs (kills
   *  ratio-lottery hits in chop — random wiggles match Fibonacci windows by
   *  luck when legs are noise-sized). */
  minLegAtr: number;
  /** Evaluated in declared order; every constraint must pass. */
  ratios: readonly RatioSpec[];
  /**
   * Optional structural veto, checked before ratios. Template-level on
   * purpose: retracement patterns (Gartley/Bat) require D INSIDE the XA leg,
   * while extension patterns (Butterfly/Crab) complete BEYOND X — an
   * engine-global guard would make extension rows impossible.
   */
  guard?: (window: readonly Swing[], dir: 1 | -1) => boolean;
  /** Calibrated formula — must reproduce its detector's output bit-exactly. */
  confidence: (m: MatchResult) => number;
  target: (window: readonly Swing[], m: MatchResult) => number;
  invalidation: (window: readonly Swing[], m: MatchResult) => number;
}
