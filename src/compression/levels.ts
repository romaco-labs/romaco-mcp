import type { Candle, LevelDetail, LevelsSummary } from './types.js';
import { findCandleSwings } from './pivots.js';
import { atr } from './volatility.js';

/**
 * 1D K-means clustering on price levels.
 * Used to find support/resistance zones from swing highs/lows.
 */
function kmeans1d(values: number[], k: number, iterations = 30): number[] {
  if (values.length === 0) return [];
  if (values.length <= k) return [...values].sort((a, b) => a - b);

  // Initialize centroids using quantiles (better than random for 1D)
  const sorted = [...values].sort((a, b) => a - b);
  const centroids: number[] = [];
  for (let i = 0; i < k; i++) {
    const q = (i + 0.5) / k;
    centroids.push(sorted[Math.floor(q * sorted.length)]);
  }

  for (let iter = 0; iter < iterations; iter++) {
    const groups: number[][] = Array.from({ length: k }, () => []);

    for (const v of values) {
      let nearest = 0;
      let nearestDist = Math.abs(v - centroids[0]);
      for (let c = 1; c < k; c++) {
        const d = Math.abs(v - centroids[c]);
        if (d < nearestDist) {
          nearestDist = d;
          nearest = c;
        }
      }
      groups[nearest].push(v);
    }

    let changed = false;
    for (let c = 0; c < k; c++) {
      if (groups[c].length === 0) continue;
      const mean = groups[c].reduce((a, b) => a + b, 0) / groups[c].length;
      if (Math.abs(mean - centroids[c]) > 1e-6) changed = true;
      centroids[c] = mean;
    }
    if (!changed) break;
  }

  return centroids.sort((a, b) => a - b);
}

/**
 * Find swing highs and lows using a lookback window.
 * A bar is a swing high if its high is greater than ALL highs in the lookback window on both sides.
 * Delegates to the shared pivot engine.
 */
function findSwingExtremes(candles: Candle[], lookback = 3): { highs: number[]; lows: number[] } {
  const swings = findCandleSwings(candles, lookback);
  return {
    highs: swings.filter((s) => s.kind === 'high').map((s) => s.price),
    lows: swings.filter((s) => s.kind === 'low').map((s) => s.price),
  };
}

/**
 * Volume Profile — computes POC, VAH, VAL.
 * POC = price level with highest traded volume.
 * Value Area = price band containing 70% of volume around POC.
 *
 * Approximates volume at each bin by distributing each candle's volume
 * uniformly across its [low, high] range.
 */
function volumeProfile(candles: Candle[], bins = 50): { poc: number; vah: number; val: number } {
  if (candles.length === 0) return { poc: 0, vah: 0, val: 0 };

  let minPrice = Infinity;
  let maxPrice = -Infinity;
  for (const c of candles) {
    if (c.low < minPrice) minPrice = c.low;
    if (c.high > maxPrice) maxPrice = c.high;
  }
  if (minPrice === maxPrice) return { poc: minPrice, vah: minPrice, val: minPrice };

  const binWidth = (maxPrice - minPrice) / bins;
  const histogram = new Array<number>(bins).fill(0);

  for (const c of candles) {
    const lowBin = Math.floor((c.low - minPrice) / binWidth);
    const highBin = Math.min(bins - 1, Math.floor((c.high - minPrice) / binWidth));
    const span = Math.max(1, highBin - lowBin + 1);
    const vPerBin = c.volume / span;
    for (let b = lowBin; b <= highBin; b++) {
      histogram[b] += vPerBin;
    }
  }

  // POC = bin with max volume
  let pocBin = 0;
  let maxV = -1;
  for (let b = 0; b < bins; b++) {
    if (histogram[b] > maxV) {
      maxV = histogram[b];
      pocBin = b;
    }
  }

  const totalVolume = histogram.reduce((a, b) => a + b, 0);
  const target = totalVolume * 0.7;
  let acc = histogram[pocBin];
  let lo = pocBin;
  let hi = pocBin;

  // Expand outward from POC until 70% of volume is captured
  while (acc < target && (lo > 0 || hi < bins - 1)) {
    const left = lo > 0 ? histogram[lo - 1] : -1;
    const right = hi < bins - 1 ? histogram[hi + 1] : -1;
    if (left >= right && lo > 0) {
      lo--;
      acc += histogram[lo];
    } else if (hi < bins - 1) {
      hi++;
      acc += histogram[hi];
    } else if (lo > 0) {
      lo--;
      acc += histogram[lo];
    } else {
      break;
    }
  }

  return {
    poc: minPrice + (pocBin + 0.5) * binWidth,
    vah: minPrice + (hi + 1) * binWidth,
    val: minPrice + lo * binWidth,
  };
}

/** A swing tests a level when within this many ATRs of it. */
const LEVEL_TOUCH_TOL_ATR = 0.3;
/** Touch count that maps to full strength. */
const LEVEL_FULL_TOUCHES = 5;

/**
 * Find support and resistance levels via swing clustering + volume profile.
 * Returns up to 3 support and 3 resistance levels relative to current price.
 *
 * `withDetail` additionally reports per-level touch counts / strength /
 * last-test timestamp. Off by default so MarketSummary (and the thesis token
 * budget) are unaffected.
 */
export function findLevels(
  candles: Candle[],
  opts: { maxClusters?: number; withDetail?: boolean } = {},
): LevelsSummary {
  if (candles.length === 0) {
    return { support: [], resistance: [], poc: 0, vah: 0, val: 0 };
  }

  const k = opts.maxClusters ?? 6;
  const { highs, lows } = findSwingExtremes(candles, 3);
  const currentPrice = candles[candles.length - 1].close;

  // Cluster all extremes together (S and R are the same kind of level)
  const allLevels = [...highs, ...lows];
  const clusters = allLevels.length === 0 ? [] : kmeans1d(allLevels, Math.min(k, allLevels.length));

  // Split into above (resistance) and below (support) current price
  const resistance = clusters.filter(l => l > currentPrice).slice(0, 3);
  const support = clusters.filter(l => l < currentPrice).slice(-3); // closest 3 below

  const { poc, vah, val } = volumeProfile(candles);

  const summary: LevelsSummary = { support, resistance, poc, vah, val };
  if (opts.withDetail) {
    // ATR and swings are level-independent — compute once for all 6 levels,
    // not once per level.
    const series = atr(candles);
    let lastAtr = 0;
    for (let i = series.length - 1; i >= 0; i--) {
      if (!Number.isNaN(series[i]) && series[i] > 0) { lastAtr = series[i]; break; }
    }
    const swings = findCandleSwings(candles, 3);
    summary.detail = {
      support: support.map((p) => levelDetail(p, candles, lastAtr, swings)),
      resistance: resistance.map((p) => levelDetail(p, candles, lastAtr, swings)),
    };
  }
  return summary;
}

/** Touch evidence for one level: swings within tolerance, recency-weighted. */
function levelDetail(
  price: number,
  candles: Candle[],
  lastAtr: number,
  swings: ReturnType<typeof findCandleSwings>,
): LevelDetail {
  const tol = lastAtr > 0 ? LEVEL_TOUCH_TOL_ATR * lastAtr : price * 0.005;

  const touchesAt = swings.filter((s) => Math.abs(s.price - price) <= tol);
  const touches = touchesAt.length;
  const lastTouchTs = touchesAt.length ? Math.max(...touchesAt.map((s) => s.ts)) : 0;

  const firstTs = candles[0].timestamp;
  const lastTs = candles[candles.length - 1].timestamp;
  const span = lastTs - firstTs;
  const recency = span > 0 && lastTouchTs > 0 ? (lastTouchTs - firstTs) / span : 0;
  const clamp01 = (x: number): number => (x < 0 ? 0 : x > 1 ? 1 : x);
  const strength = clamp01(touches / LEVEL_FULL_TOUCHES) * (0.5 + 0.5 * recency);

  return { price, touches, strength, last_touch_ts: lastTouchTs };
}
