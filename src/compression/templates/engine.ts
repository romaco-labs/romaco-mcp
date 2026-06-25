import type { PatternHit, Swing } from '../types.js';
import type { MatchResult, PatternTemplate } from './schema.js';

/**
 * Generic template matcher over zigzag pivots.
 *
 * EMISSION ORDER IS CONTRACT (the golden snapshots pin it): arity groups in
 * first-declared order; within a group, windows ascending (oldest first);
 * within a window, templates in declared order. For the v1 harmonic set this
 * reproduces detectHarmonics exactly — all ABCD hits (window-ascending), then
 * all XABCD hits.
 *
 * Every template of a window's arity is evaluated — there is no first-match
 * arbitration. v1's if/else family dispatch is equivalent BECAUSE the shipped
 * B-windows are disjoint (Gartley [0.568, 0.668] vs Bat [0.332, 0.55]); the
 * property tests assert pairwise full-gate-set exclusivity for the shipped
 * rows so overlapping future rows (Crab's B overlaps Bat's) must stay
 * separated by their other gates.
 *
 * O(M·T·k) over M ≤ maxSwings pivots, T templates, k ≤ 7 dims — a few hundred
 * float comparisons. This is why there is no signature hashing: the linear
 * scan costs sub-microseconds, hash quantization cannot reproduce the ±tol
 * `<=` boundaries, and graded confidence needs the continuous distance to the
 * matched anchor anyway.
 */
export function detectTemplates(
  zz: Swing[],
  atr: number,
  templates: readonly PatternTemplate[],
  maxSwings = 12,
): PatternHit[] {
  if (atr <= 0 || templates.length === 0) return [];
  const swings = zz.slice(-maxSwings);
  const out: PatternHit[] = [];

  const arities: number[] = [];
  for (const t of templates) {
    if (!arities.includes(t.arity)) arities.push(t.arity);
  }

  for (const arity of arities) {
    const group = templates.filter((t) => t.arity === arity);
    for (let i = 0; i + arity - 1 < swings.length; i++) {
      const window = swings.slice(i, i + arity);
      for (const t of group) {
        const hit = matchTemplate(window, atr, t);
        if (hit) out.push(hit);
      }
    }
  }
  return out;
}

function matchTemplate(window: Swing[], atr: number, t: PatternTemplate): PatternHit | null {
  // Leg gate: every consecutive leg must be a genuine impulse.
  const minLeg = t.minLegAtr * atr;
  for (let k = 1; k < window.length; k++) {
    if (Math.abs(window[k].price - window[k - 1].price) < minLeg) return null;
  }

  // Direction from the template's anchor pivot (zigzag alternation guarantees
  // the opposite case is the exact bearish mirror).
  const bullish = window[t.bullishWhen.point].kind === t.bullishWhen.kind;
  const dir: 1 | -1 = bullish ? 1 : -1;

  if (t.guard && !t.guard(window, dir)) return null;

  // Ratio gates in declared order. All rejections are conjunctive pure
  // predicates, so gate order never changes the outcome — only the cost.
  const ratios: Record<string, number> = {};
  const matchedAnchor: Record<string, number> = {};
  for (const spec of t.ratios) {
    const num = Math.abs(window[spec.num[0]].price - window[spec.num[1]].price);
    const den = Math.abs(window[spec.den[0]].price - window[spec.den[1]].price);
    const value = num / den; // denominators are legs, all ≥ minLeg > 0
    ratios[spec.name] = value;
    const c = spec.constraint;
    if (c.kind === 'anchors') {
      // find-first like v1; shipped anchor sets are disjoint at ±tol.
      const matched = c.anchors.find((a) => Math.abs(value - a) <= c.tol);
      if (matched === undefined) return null;
      matchedAnchor[spec.name] = matched;
    } else if (!(value >= c.min - c.tol && value <= c.max + c.tol)) {
      return null;
    }
  }

  const m: MatchResult = { ratios, matchedAnchor, dir, atr };
  return {
    kind: bullish ? t.kindBull : t.kindBear,
    confidence: t.confidence(m),
    points: window.map((s, k) => ({ ts: s.ts, price: s.price, role: t.roles[k] })),
    target_price: t.target(window, m),
    invalidation_price: t.invalidation(window, m),
  };
}
