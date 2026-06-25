import type { Candle, PatternHit } from './types.js';
import type { ScanContext } from './scanContext.js';
import { atr as atrSeries } from './volatility.js';

/**
 * Price gaps: empty space between consecutive candles' high/low.
 *
 * Honest-signal contract:
 *   - SIZE: the gap must clear GAP_MIN_ATR × the ATR *at that moment*
 *     (trailing ATR at the pre-gap candle) — markets are full of sub-noise
 *     micro-gaps; only momentum gaps count.
 *   - UNFILLED: a gap that price later traded back through is consumed —
 *     reporting it would be a stale signal. Only open gaps are emitted.
 *   - CAP: at most the most recent GAP_MAX_HITS open gaps, newest last —
 *     a gappy ticker must not flood the pattern list.
 *
 * Gaps carry direction as momentum evidence (gap_up bullish / gap_down
 * bearish) with the FILL level as invalidation. No target is projected:
 * a gap is context, not a measured-move setup — inventing one would be
 * exactly the hallucination this engine exists to avoid.
 */

/** Minimum gap size, in contemporary ATRs. */
const GAP_MIN_ATR = 0.5;
/** Most recent open gaps reported. */
const GAP_MAX_HITS = 3;

export function detectGaps(candles: Candle[], ctx?: ScanContext): PatternHit[] {
  const n = candles.length;
  if (n < 16) return []; // need ATR warm-up
  const series = ctx?.atr14 ?? atrSeries(candles);

  const hits: PatternHit[] = [];
  for (let i = 1; i < n; i++) {
    const a = series[i - 1]; // volatility as of the pre-gap candle
    if (Number.isNaN(a) || a <= 0) continue;
    const prev = candles[i - 1];
    const cur = candles[i];

    const upGap = cur.low - prev.high;
    const downGap = prev.low - cur.high;

    // Fill checks via suffix extrema when available: "any later candle traded
    // back through the gap edge" ≡ suffix min/max vs the edge — the identical
    // boolean the forward loop computes, without the loop. (Unfilled gaps in a
    // trending series used to pay a scan to the end of the series, each.)
    if (upGap >= GAP_MIN_ATR * a) {
      // Filled when any later candle traded back down to the pre-gap high.
      let filled = false;
      if (ctx) {
        filled = ctx.suffixMinLow[i + 1] <= prev.high;
      } else {
        for (let j = i + 1; j < n; j++) {
          if (candles[j].low <= prev.high) { filled = true; break; }
        }
      }
      if (!filled) hits.push(gapHit('gap_up', prev, cur, prev.high, cur.low, upGap, a));
    } else if (downGap >= GAP_MIN_ATR * a) {
      let filled = false;
      if (ctx) {
        filled = ctx.suffixMaxHigh[i + 1] >= prev.low;
      } else {
        for (let j = i + 1; j < n; j++) {
          if (candles[j].high >= prev.low) { filled = true; break; }
        }
      }
      if (!filled) hits.push(gapHit('gap_down', prev, cur, cur.high, prev.low, downGap, a));
    }
  }

  return hits.slice(-GAP_MAX_HITS);
}

function gapHit(
  kind: 'gap_up' | 'gap_down',
  prev: Candle,
  cur: Candle,
  zoneLow: number,
  zoneHigh: number,
  size: number,
  atr: number,
): PatternHit {
  return {
    kind,
    // Bigger gap (vs its own ATR) = stronger momentum statement, cap at 2 ATR.
    confidence: Math.min(0.85, 0.5 + 0.25 * Math.min(size / (2 * atr), 1)),
    points: [
      { ts: prev.timestamp, price: zoneLow, role: 'gap_low' },
      { ts: cur.timestamp, price: zoneHigh, role: 'gap_high' },
    ],
    // Momentum dies when the gap fills: the far edge is the fill level.
    invalidation_price: kind === 'gap_up' ? zoneLow : zoneHigh,
  };
}
