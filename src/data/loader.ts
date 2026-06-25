import type { Candle } from '../compression/types.js';
import type { DataSource, DataSourceName, LoadRequest, LoadResponse } from './types.js';
import { yfinance } from './sources/yfinance.js';
import { raw } from './sources/raw.js';
import { readCache, writeCache } from './cache.js';

const sources: Record<DataSourceName, DataSource> = {
  yfinance,
  raw,
};

// Coalesces concurrent identical requests so a grid of N widgets asking for the
// same (symbol, timeframe, lookback) triggers one upstream fetch, not N.
// Registration is synchronous (no await before inflight.set), so parallel callers
// in the same tick all observe the same promise.
const inflight = new Map<string, Promise<Candle[]>>();

function inflightKey(req: LoadRequest): string {
  return `${req.source}:${req.symbol}:${req.timeframe}:${req.lookback ?? 500}`;
}

async function fetchWithCache(source: DataSource, req: LoadRequest): Promise<Candle[]> {
  const cached = await readCache(req);
  if (cached) return cached;
  const fresh = await source.fetchCandles(req);
  // Await write so the next caller sees it. Swallow write errors so a broken
  // cache dir never blocks data delivery.
  try {
    await writeCache(req, fresh);
  } catch {
    /* cache write failed — fall through */
  }
  return fresh;
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

  let candles: Candle[];

  if (req.source === 'raw') {
    // raw is user-supplied; never cache or dedup.
    candles = await source.fetchCandles(req);
  } else {
    const key = inflightKey(req);
    let promise = inflight.get(key);
    if (!promise) {
      promise = fetchWithCache(source, req).finally(() => inflight.delete(key));
      inflight.set(key, promise);
    }
    candles = await promise;
  }

  return {
    source: req.source,
    symbol: req.symbol,
    timeframe: req.timeframe,
    candles,
    fetched_at: Date.now(),
  };
}
