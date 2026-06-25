import type { Candle, PatternHit } from './types.js';
import { detectPatterns } from './patterns.js';

/**
 * Per-candle-array scan memo.
 *
 * detectPatterns / composeMarketSummary / analyzeSession are pure functions of
 * the candle array, yet a typical agent flow (setup_chart → thesis → annotate
 * → draw_pattern) used to recompute the identical scan four times: every tool
 * called the compression layer independently and session state holds no
 * results.
 *
 * Keyed by ARRAY IDENTITY in a WeakMap — every load path (yfinance fetch,
 * disk cache, raw) materializes a fresh Candle[] through JSON parsing, so
 * identity cannot collide and the GC handles eviction; no invalidation hooks
 * needed. thesis_batch stores the winning load (the same array) into the
 * session, so a follow-up draw_pattern hits this cache for free.
 *
 * A content stamp (length + last bar) is re-checked on every lookup: if a
 * future feature mutates the live bar in place, the stale bundle is dropped
 * and the scan recomputes. Cached values are deep-frozen at fill time — a
 * consumer that tries to mutate a shared result throws immediately instead of
 * silently corrupting every later reader. (Current consumers all copy before
 * sorting/slicing — trimPatternHits and selectRecentPatterns map/filter into
 * fresh arrays, setup_chart sorts the trimmed copy; audited 2026-06-12.)
 *
 * Anti-drift compatibility (draw_pattern / annotate): their contract is
 * determinism FROM THE SESSION CANDLES — geometry must come from
 * re-detection, never from agent-supplied numbers. A memo keyed on the candle
 * array returns exactly what re-detection would return for those candles, by
 * construction.
 */

interface Stamp {
  length: number;
  lastTs: number;
  lastClose: number;
  lastHigh: number;
  lastLow: number;
}

interface ScanBundle {
  stamp: Stamp;
  slots: Map<string, unknown>;
}

const cache = new WeakMap<Candle[], ScanBundle>();

function stampOf(candles: Candle[]): Stamp {
  const last = candles[candles.length - 1];
  return {
    length: candles.length,
    lastTs: last.timestamp,
    lastClose: last.close,
    lastHigh: last.high,
    lastLow: last.low,
  };
}

function stampMatches(a: Stamp, b: Stamp): boolean {
  return (
    a.length === b.length &&
    a.lastTs === b.lastTs &&
    a.lastClose === b.lastClose &&
    a.lastHigh === b.lastHigh &&
    a.lastLow === b.lastLow
  );
}

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const key of Object.getOwnPropertyNames(value)) {
      deepFreeze((value as Record<string, unknown>)[key]);
    }
  }
  return value;
}

/**
 * Compute-once per (candle array, slot). Empty arrays bypass the cache (no
 * last bar to stamp; the computes are trivial there anyway).
 */
export function memoScan<T>(candles: Candle[], slot: string, compute: () => T): T {
  if (candles.length === 0) return compute();
  let bundle = cache.get(candles);
  if (bundle && !stampMatches(bundle.stamp, stampOf(candles))) bundle = undefined;
  if (!bundle) {
    bundle = { stamp: stampOf(candles), slots: new Map() };
    cache.set(candles, bundle);
  }
  if (bundle.slots.has(slot)) return bundle.slots.get(slot) as T;
  const value = deepFreeze(compute());
  bundle.slots.set(slot, value);
  return value;
}

/**
 * Memoized detectPatterns — identical output, computed once per array.
 * The result is deep-frozen; copy (filter/map/slice) before reordering.
 */
export function cachedDetectPatterns(candles: Candle[]): PatternHit[] {
  return memoScan(candles, 'patterns', () => detectPatterns(candles));
}
