import type { DataSource, DataSourceName, LoadRequest, LoadResponse } from './types.js';
import { yfinance } from './sources/yfinance.js';
import { raw } from './sources/raw.js';
import { readCache, writeCache, type CachedCandles } from './cache.js';

const sources: Record<DataSourceName, DataSource> = {
  yfinance,
  raw,
};

// Coalesces concurrent identical requests so a grid of N widgets asking for the
// same (symbol, timeframe, lookback) triggers one upstream fetch, not N.
// Registration is synchronous (no await before inflight.set), so parallel callers
// in the same tick all observe the same promise.
type LoadedCandles = CachedCandles & { cacheHit: boolean };
const inflight = new Map<string, Promise<LoadedCandles>>();

function inflightKey(req: LoadRequest): string {
  return `${req.source}:${req.symbol}:${req.timeframe}:${req.lookback ?? 500}`;
}

async function fetchWithCache(source: DataSource, req: LoadRequest): Promise<LoadedCandles> {
  const cached = await readCache(req);
  if (cached) return { ...cached, cacheHit: true };
  const candles = await source.fetchCandles(req);
  const fresh = { candles, fetchedAt: Date.now() };
  // Await write so the next caller sees it. Swallow write errors so a broken
  // cache dir never blocks data delivery.
  try {
    await writeCache(req, fresh);
  } catch {
    /* cache write failed — fall through */
  }
  return { ...fresh, cacheHit: false };
}

/**
 * Unified candle loader. Routes to the appropriate data source.
 * For non-`raw` sources: serves from disk cache when fresh, otherwise fetches
 * (with in-flight dedup) and writes the result to cache.
 */
export async function loadCandles(req: LoadRequest): Promise<LoadResponse> {
  const source = sources[req.source];
  if (!source) {
    throw new Error(`Unknown data source: ${req.source}. Available: ${Object.keys(sources).join(', ')}`);
  }

  let loaded: LoadedCandles;

  if (req.source === 'raw') {
    // raw is user-supplied; never cache or dedup.
    const candles = await source.fetchCandles(req);
    loaded = { candles, fetchedAt: Date.now(), cacheHit: false };
  } else {
    const key = inflightKey(req);
    let promise = inflight.get(key);
    if (!promise) {
      promise = fetchWithCache(source, req).finally(() => inflight.delete(key));
      inflight.set(key, promise);
    }
    loaded = await promise;
  }

  return {
    source: req.source,
    symbol: req.symbol,
    timeframe: req.timeframe,
    candles: loaded.candles,
    fetched_at: loaded.fetchedAt,
    served_at: Date.now(),
    cache_hit: loaded.cacheHit,
  };
}
