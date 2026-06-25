import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { Candle } from '../../src/compression/types.js';
import type { LoadRequest } from '../../src/data/types.js';

const c = (ts: number, p: number): Candle => ({
  timestamp: ts,
  open: p,
  high: p + 1,
  low: p - 1,
  close: p,
  volume: 1000,
});

describe('loadCandles — original routing', () => {
  it('routes to raw source', async () => {
    const { loadCandles } = await import('../../src/data/loader.js');
    const candles = [c(1, 100), c(2, 101)];
    const r = await loadCandles({ source: 'raw', symbol: 'TEST', timeframe: '1h', rawCandles: candles });
    expect(r.candles).toEqual(candles);
    expect(r.source).toBe('raw');
    expect(r.symbol).toBe('TEST');
    expect(r.timeframe).toBe('1h');
  });

  it('returns fetched_at timestamp', async () => {
    const { loadCandles } = await import('../../src/data/loader.js');
    const before = Date.now();
    const r = await loadCandles({ source: 'raw', symbol: 'TEST', timeframe: '1h', rawCandles: [c(1, 100)] });
    const after = Date.now();
    expect(r.fetched_at).toBeGreaterThanOrEqual(before);
    expect(r.fetched_at).toBeLessThanOrEqual(after);
  });

  it('throws on unknown source', async () => {
    const { loadCandles } = await import('../../src/data/loader.js');
    await expect(
      loadCandles({ source: 'unknown' as 'raw', symbol: 'TEST', timeframe: '1h' }),
    ).rejects.toThrow(/Unknown data source/);
  });

  it('propagates errors from source', async () => {
    const { loadCandles } = await import('../../src/data/loader.js');
    await expect(
      loadCandles({ source: 'raw', symbol: 'TEST', timeframe: '1h' }),
    ).rejects.toThrow(/requires rawCandles/);
  });
});

// -----------------------------------------------------------------------------
// New: in-flight dedup + cache integration. Uses a mocked yfinance source so we
// can count fetch invocations independently of network.
// -----------------------------------------------------------------------------

const sampleCandles: Candle[] = [c(1000, 100), c(2000, 101)];
const fetchSpy = vi.fn<(req: LoadRequest) => Promise<Candle[]>>();

vi.mock('../../src/data/sources/yfinance.js', () => ({
  yfinance: {
    name: 'yfinance' as const,
    fetchCandles: (req: LoadRequest) => fetchSpy(req),
  },
}));

let originalEnv: string | undefined;

describe('loadCandles — in-flight dedup + cache', () => {
  beforeEach(() => {
    fetchSpy.mockReset();
    originalEnv = process.env.ROMACO_CACHE_DIR;
    process.env.ROMACO_CACHE_DIR = path.join(
      tmpdir(),
      `romaco-loader-test-${Date.now()}-${Math.random()}`,
    );
    // Re-import the cache module to pick up the new env. Vitest caches modules
    // by path; clearing the registry ensures cache.ts re-evaluates cacheDir().
    vi.resetModules();
  });

  afterEach(async () => {
    if (process.env.ROMACO_CACHE_DIR) {
      await fs.rm(process.env.ROMACO_CACHE_DIR, { recursive: true, force: true }).catch(() => {});
    }
    if (originalEnv === undefined) delete process.env.ROMACO_CACHE_DIR;
    else process.env.ROMACO_CACHE_DIR = originalEnv;
  });

  const aaplReq: LoadRequest = { source: 'yfinance', symbol: 'AAPL', timeframe: '1d', lookback: 500 };
  const nvdaReq: LoadRequest = { ...aaplReq, symbol: 'NVDA' };

  it('parallel calls for same key dedup to a single source fetch', async () => {
    const { loadCandles } = await import('../../src/data/loader.js');
    fetchSpy.mockResolvedValue(sampleCandles);

    const results = await Promise.all([
      loadCandles(aaplReq),
      loadCandles(aaplReq),
      loadCandles(aaplReq),
      loadCandles(aaplReq),
    ]);

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    for (const r of results) expect(r.candles).toEqual(sampleCandles);
  });

  it('parallel calls for different symbols each fetch separately', async () => {
    const { loadCandles } = await import('../../src/data/loader.js');
    fetchSpy.mockResolvedValue(sampleCandles);

    await Promise.all([loadCandles(aaplReq), loadCandles(nvdaReq)]);
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });

  it('second sequential call hits disk cache (no second fetch)', async () => {
    const { loadCandles } = await import('../../src/data/loader.js');
    fetchSpy.mockResolvedValue(sampleCandles);

    await loadCandles(aaplReq);
    // Wait for best-effort writeCache to finish.
    await new Promise((r) => setImmediate(r));
    await loadCandles(aaplReq);

    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it('source error rejects waiters and clears inflight (next call re-fetches)', async () => {
    const { loadCandles } = await import('../../src/data/loader.js');
    fetchSpy.mockRejectedValueOnce(new Error('source down'));

    const [r1, r2] = await Promise.allSettled([loadCandles(aaplReq), loadCandles(aaplReq)]);
    expect(r1.status).toBe('rejected');
    expect(r2.status).toBe('rejected');
    expect(fetchSpy).toHaveBeenCalledTimes(1);

    fetchSpy.mockResolvedValueOnce(sampleCandles);
    const r3 = await loadCandles(aaplReq);
    expect(r3.candles).toEqual(sampleCandles);
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });
});
