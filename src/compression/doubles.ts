import type { Candle, PatternHit, Swing } from './types.js';

/**
 * Classic price action: double and triple tops/bottoms (M / W structures) on
 * zigzag pivots.
 *
 * Honest-signal contract — the two gates that kill range-chop hallucinations:
 *   1. ALIGNMENT: the tops (or bottoms) must sit at the same level, where
 *      "same" means within 1.5% of price AND within one ATR — a 1.5% band on
 *      a high-volatility instrument is sub-noise, so both must hold.
 *   2. DEPTH: the structure's height (peaks to neckline) must clear 2× ATR.
 *      A retest separated by a shallow dip is a pause, not a reversal
 *      structure. (Zigzag already filters sub-ATR wiggles; this demands a
 *      genuine impulse between the tests.)
 *
 * This module REPLACES the original 2%-relative detector, which fired 6–10
 * overlapping doubles per real daily chart — exactly the hallucination the
 * gates above exist to prevent.
 */

/** Tops/bottoms must match within this fraction of price… */
const MW_ALIGN_MAX_PCT = 0.015;
/** …and within this many ATRs (both must hold). */
const MW_ALIGN_MAX_ATR = 1.0;
/** Peaks-to-neckline height must clear this many ATRs (the anti-noise rule). */
const MW_MIN_HEIGHT_ATR = 2.0;
/** Scan at most this many of the most recent zigzag swings. */
const MW_MAX_SWINGS = 14;
// LIVENESS: the pattern is only a signal while it is still in play — the last
// close must sit strictly INSIDE the band between the neckline and the
// invalidation level. A close beyond the tops already invalidated the M; a
// close beyond the neckline means the break already happened and the move is
// running (reporting it would be a stale signal, the curse of random-walk
// look-backs: the seeded negative fixture produced exactly such dead hits).
// NOTE: this check reads only the LAST close — the intermediate history is
// covered by the central breach guard in patterns.ts (breachedSinceCompletion),
// which kills patterns whose levels were already hit and then re-entered.

function pt(s: Swing, role: string): PatternHit['points'][number] {
  return { ts: s.ts, price: s.price, role };
}

/**
 * Detect double (3 zigzag pivots) and triple (5 pivots) tops/bottoms.
 * Triples consume their doubles: when H-L-H-L-H validates as a triple top,
 * the overlapping double windows inside it are suppressed — one structure,
 * one signal.
 */
export function detectDoubleTriple(candles: Candle[], zz: Swing[], atr: number): PatternHit[] {
  if (atr <= 0 || candles.length === 0) return [];
  const lastClose = candles[candles.length - 1].close;
  const swings = zz.slice(-MW_MAX_SWINGS);
  const out: PatternHit[] = [];
  const usedInTriple = new Set<Swing>();

  // Triples first (5 alternating pivots), so they can claim their swings.
  for (let i = 0; i + 4 < swings.length; i++) {
    const w = swings.slice(i, i + 5);
    const hit = evaluateTriple(w, atr, lastClose);
    if (hit) {
      out.push(hit);
      for (const s of w) usedInTriple.add(s);
    }
  }

  // Doubles (3 alternating pivots) — skip windows fully claimed by a triple.
  for (let i = 0; i + 2 < swings.length; i++) {
    const w = swings.slice(i, i + 3);
    if (w.every((s) => usedInTriple.has(s))) continue;
    const hit = evaluateDouble(w[0], w[1], w[2], atr, lastClose);
    if (hit) out.push(hit);
  }

  return out;
}

/** Liveness band: strictly between the neckline and the invalidation level. */
function stillInPlay(lastClose: number, neckline: number, invalidation: number): boolean {
  const lo = Math.min(neckline, invalidation);
  const hi = Math.max(neckline, invalidation);
  return lastClose > lo && lastClose < hi;
}

/** Both alignment rules: within 1.5% of price AND within 1 ATR. */
function aligned(prices: number[], atr: number): boolean {
  const max = Math.max(...prices);
  const min = Math.min(...prices);
  const spread = max - min;
  return spread <= MW_ALIGN_MAX_PCT * max && spread <= MW_ALIGN_MAX_ATR * atr;
}

function evaluateDouble(a: Swing, mid: Swing, b: Swing, atr: number, lastClose: number): PatternHit | null {
  // M: high-low-high. W: low-high-low. (Zigzag guarantees alternation.)
  const isTop = a.kind === 'high' && mid.kind === 'low' && b.kind === 'high';
  const isBottom = a.kind === 'low' && mid.kind === 'high' && b.kind === 'low';
  if (!isTop && !isBottom) return null;

  if (!aligned([a.price, b.price], atr)) return null;

  const peaks = (a.price + b.price) / 2;
  const neckline = mid.price;
  const height = isTop ? peaks - neckline : neckline - peaks;
  if (height < MW_MIN_HEIGHT_ATR * atr) return null;

  const extreme = isTop ? Math.max(a.price, b.price) : Math.min(a.price, b.price);
  if (!stillInPlay(lastClose, neckline, extreme)) return null;

  const dir = isTop ? -1 : 1;
  const spread = Math.abs(a.price - b.price);
  const alignTol = Math.min(MW_ALIGN_MAX_PCT * Math.max(a.price, b.price), MW_ALIGN_MAX_ATR * atr);
  const confidence = Math.min(
    0.85,
    0.5 +
      0.2 * (1 - spread / alignTol) +
      0.15 * Math.min(height / (3 * MW_MIN_HEIGHT_ATR * atr / 2), 1),
  );

  return {
    kind: isTop ? 'double_top' : 'double_bottom',
    confidence,
    points: isTop
      ? [pt(a, 'top_1'), pt(mid, 'valley'), pt(b, 'top_2')]
      : [pt(a, 'bottom_1'), pt(mid, 'peak'), pt(b, 'bottom_2')],
    // Measured move: project the height beyond the neckline.
    target_price: neckline + dir * height,
    invalidation_price: isTop ? Math.max(a.price, b.price) : Math.min(a.price, b.price),
  };
}

function evaluateTriple(w: Swing[], atr: number, lastClose: number): PatternHit | null {
  const [p1, v1, p2, v2, p3] = w;
  const isTop =
    p1.kind === 'high' && v1.kind === 'low' && p2.kind === 'high' && v2.kind === 'low' && p3.kind === 'high';
  const isBottom =
    p1.kind === 'low' && v1.kind === 'high' && p2.kind === 'low' && v2.kind === 'high' && p3.kind === 'low';
  if (!isTop && !isBottom) return null;

  if (!aligned([p1.price, p2.price, p3.price], atr)) return null;

  const peaks = (p1.price + p2.price + p3.price) / 3;
  // Conservative neckline: the FAR valley — the structure only breaks when
  // ALL of its support (resistance) has gone.
  const neckline = isTop ? Math.min(v1.price, v2.price) : Math.max(v1.price, v2.price);
  const height = isTop ? peaks - neckline : neckline - peaks;
  if (height < MW_MIN_HEIGHT_ATR * atr) return null;

  const extreme = isTop
    ? Math.max(p1.price, p2.price, p3.price)
    : Math.min(p1.price, p2.price, p3.price);
  if (!stillInPlay(lastClose, neckline, extreme)) return null;

  const dir = isTop ? -1 : 1;
  const spread = Math.max(p1.price, p2.price, p3.price) - Math.min(p1.price, p2.price, p3.price);
  const alignTol = Math.min(
    MW_ALIGN_MAX_PCT * Math.max(p1.price, p2.price, p3.price),
    MW_ALIGN_MAX_ATR * atr,
  );
  // A level tested three times is stronger evidence than twice: small bonus.
  const confidence = Math.min(
    0.85,
    0.55 +
      0.18 * (1 - spread / alignTol) +
      0.12 * Math.min(height / (3 * MW_MIN_HEIGHT_ATR * atr / 2), 1),
  );

  return {
    kind: isTop ? 'triple_top' : 'triple_bottom',
    confidence,
    points: isTop
      ? [pt(p1, 'top_1'), pt(v1, 'valley_1'), pt(p2, 'top_2'), pt(v2, 'valley_2'), pt(p3, 'top_3')]
      : [pt(p1, 'bottom_1'), pt(v1, 'peak_1'), pt(p2, 'bottom_2'), pt(v2, 'peak_2'), pt(p3, 'bottom_3')],
    target_price: neckline + dir * height,
    invalidation_price: isTop
      ? Math.max(p1.price, p2.price, p3.price)
      : Math.min(p1.price, p2.price, p3.price),
  };
}
