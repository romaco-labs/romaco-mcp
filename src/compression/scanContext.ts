import type { Candle, Swing } from './types.js';
import { findCandleSwings, zigzagFilter } from './pivots.js';
import { atr } from './volatility.js';

/**
 * ScanContext — shared per-scan primitives, built ONCE per detectPatterns run.
 *
 * Before this existed, one scan computed the full-series ATR(14) three times
 * (zigzag reversal threshold, last-ATR gate, gap sizing) and every breach /
 * gap-fill check paid a forward loop over the candle suffix.
 *
 * Suffix extrema turn those loops into O(1) lookups:
 *   suffixMinLow[i]  = min(low[i..N-1])    →  "did any bar from i on trade ≤ X?"
 *   suffixMaxHigh[i] = max(high[i..N-1])   →  "did any bar from i on trade ≥ X?"
 * Comparisons only — no float arithmetic — so the answers are bit-identical
 * to the loops they replace. (RMQ/sparse tables were considered and rejected:
 * every hot query in this engine is a suffix, never an arbitrary range.)
 *
 * NOT shared into channel/rounding windows: those deliberately re-derive
 * window-local swings and ATR from the slice (Wilder warm-up from the window
 * start differs from the full-series values at the same bars — see the
 * CH_WINDOWS comment in channels.ts). Sharing ctx there would change output.
 */
export interface ScanContext {
  /** Full-series Wilder ATR(14); NaN during warm-up. */
  atr14: number[];
  /** Last finite positive ATR value, 0 when none (short series). */
  lastAtr: number;
  /** Zigzag reversal threshold: lastAtr, or 0.5% of last close as fallback. */
  minReversal: number;
  /** Raw candle swings (shared pivot engine, confirmation lookback). */
  swings: Swing[];
  /** Strictly alternating zigzag over `swings` using `minReversal`. */
  zigzag: Swing[];
  /** suffixMinLow[i] = min over candles[i..N-1] of low; [N] = +Infinity. */
  suffixMinLow: Float64Array;
  /** suffixMaxHigh[i] = max over candles[i..N-1] of high; [N] = -Infinity. */
  suffixMaxHigh: Float64Array;
  /** Timestamps non-decreasing? (source='raw' accepts unsorted candles). */
  sortedByTs: boolean;
  /**
   * Rightmost index whose timestamp is ≤ ts, or -1. Binary search when
   * sorted; exact replica of the v1 reverse linear scan otherwise.
   */
  lastIndexAtOrBefore(ts: number): number;
}

export function buildScanContext(candles: Candle[], lookback = 3): ScanContext {
  const n = candles.length;

  const atr14 = atr(candles);
  let lastAtr = 0;
  for (let i = atr14.length - 1; i >= 0; i--) {
    if (!Number.isNaN(atr14[i]) && atr14[i] > 0) {
      lastAtr = atr14[i];
      break;
    }
  }
  // Same fallback ladder as pivots.ts minReversalFromAtr(candles).
  const minReversal = lastAtr > 0 ? lastAtr : (n ? candles[n - 1].close * 0.005 : 0);

  const swings = findCandleSwings(candles, lookback);
  const zigzag = zigzagFilter(swings, minReversal);

  const suffixMinLow = new Float64Array(n + 1);
  const suffixMaxHigh = new Float64Array(n + 1);
  suffixMinLow[n] = Infinity;
  suffixMaxHigh[n] = -Infinity;
  for (let i = n - 1; i >= 0; i--) {
    suffixMinLow[i] = candles[i].low < suffixMinLow[i + 1] ? candles[i].low : suffixMinLow[i + 1];
    suffixMaxHigh[i] = candles[i].high > suffixMaxHigh[i + 1] ? candles[i].high : suffixMaxHigh[i + 1];
  }

  let sortedByTs = true;
  for (let i = 1; i < n; i++) {
    if (candles[i].timestamp < candles[i - 1].timestamp) {
      sortedByTs = false;
      break;
    }
  }

  const lastIndexAtOrBefore = (ts: number): number => {
    if (!sortedByTs) {
      // v1 semantics verbatim: first index from the right with timestamp ≤ ts.
      for (let i = n - 1; i >= 0; i--) {
        if (candles[i].timestamp <= ts) return i;
      }
      return -1;
    }
    // upper_bound(ts) − 1: rightmost index with timestamp ≤ ts (duplicates →
    // the last of the run, matching the reverse scan).
    let lo = 0;
    let hi = n; // first index with timestamp > ts
    while (lo < hi) {
      const mid = (lo + hi) >>> 1;
      if (candles[mid].timestamp <= ts) lo = mid + 1;
      else hi = mid;
    }
    return lo - 1;
  };

  return {
    atr14,
    lastAtr,
    minReversal,
    swings,
    zigzag,
    suffixMinLow,
    suffixMaxHigh,
    sortedByTs,
    lastIndexAtOrBefore,
  };
}
