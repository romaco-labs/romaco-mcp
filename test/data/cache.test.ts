import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { Candle } from '../../src/compression/types.js';
import type { LoadRequest } from '../../src/data/types.js';

const TMP_BASE = path.join(tmpdir(), 'romaco-cache-test');

let originalEnv: string | undefined;

beforeEach(async () => {
  originalEnv = process.env.ROMACO_CACHE_DIR;
  // Unique dir per test to avoid cross-pollination if tests run in parallel.
  process.env.ROMACO_CACHE_DIR = path.join(TMP_BASE, `${Date.now()}-${Math.random()}`);
});

afterEach(async () => {
  // Best-effort cleanup.
  if (process.env.ROMACO_CACHE_DIR) {
    await fs.rm(process.env.ROMACO_CACHE_DIR, { recursive: true, force: true }).catch(() => {});
  }
  if (originalEnv === undefined) delete process.env.ROMACO_CACHE_DIR;
  else process.env.ROMACO_CACHE_DIR = originalEnv;
});

const sampleCandles: Candle[] = [
  { timestamp: 1000, open: 100, high: 101, low: 99, close: 100.5, volume: 10_000 },
  { timestamp: 2000, open: 100.5, high: 102, low: 100, close: 101.5, volume: 11_000 },
];

const aaplReq: LoadRequest = {
  source: 'yfinance',
  symbol: 'AAPL',
  timeframe: '1d',
  lookback: 500,
};

describe('cache', () => {
  it('returns null when no entry exists (cache miss)', async () => {
    const { readCache } = await import('../../src/data/cache.js');
    const got = await readCache(aaplReq);
    expect(got).toBeNull();
  });

  it('returns candles after writeCache (cache hit)', async () => {
    const { writeCache, readCache } = await import('../../src/data/cache.js');
    await writeCache(aaplReq, { candles: sampleCandles, fetchedAt: Date.now() });
    const got = await readCache(aaplReq);
    expect(got?.candles).toEqual(sampleCandles);
    expect(got?.fetchedAt).toBeTypeOf('number');
  });

  it('distinct symbols use distinct keys (no collision)', async () => {
    const { writeCache, readCache } = await import('../../src/data/cache.js');
    const nvdaReq: LoadRequest = { ...aaplReq, symbol: 'NVDA' };
    await writeCache(aaplReq, { candles: sampleCandles, fetchedAt: Date.now() });
    await writeCache(nvdaReq, { candles: [{ ...sampleCandles[0], open: 999 }], fetchedAt: Date.now() });
    const aapl = await readCache(aaplReq);
    const nvda = await readCache(nvdaReq);
    expect(aapl?.candles[0].open).toBe(100);
    expect(nvda?.candles[0].open).toBe(999);
  });

  it('distinct timeframes use distinct keys', async () => {
    const { writeCache, readCache } = await import('../../src/data/cache.js');
    const hReq: LoadRequest = { ...aaplReq, timeframe: '1h' };
    await writeCache(aaplReq, { candles: sampleCandles, fetchedAt: Date.now() });
    await writeCache(hReq, { candles: [{ ...sampleCandles[0], open: 888 }], fetchedAt: Date.now() });
    const d = await readCache(aaplReq);
    const h = await readCache(hReq);
    expect(d?.candles[0].open).toBe(100);
    expect(h?.candles[0].open).toBe(888);
  });

  it('TTL follows acquisition time even when file mtime is fresh', async () => {
    const { writeCache, readCache } = await import('../../src/data/cache.js');
    const oneMinReq: LoadRequest = { ...aaplReq, timeframe: '1m' };
    await writeCache(oneMinReq, { candles: sampleCandles, fetchedAt: Date.now() - 2 * 60 * 60_000 });

    const dir = process.env.ROMACO_CACHE_DIR!;
    const entries = await fs.readdir(dir);
    expect(entries).toHaveLength(1);
    for (const e of entries) {
      const now = new Date();
      await fs.utimes(path.join(dir, e), now, now);
    }

    const got = await readCache(oneMinReq);
    expect(got).toBeNull();
  });

  it('refetches legacy array-only entries with unknown acquisition time', async () => {
    const { writeCache, readCache } = await import('../../src/data/cache.js');
    await writeCache(aaplReq, { candles: sampleCandles, fetchedAt: Date.now() });
    const dir = process.env.ROMACO_CACHE_DIR!;
    const [name] = await fs.readdir(dir);
    await fs.writeFile(path.join(dir, name), JSON.stringify(sampleCandles));
    expect(await readCache(aaplReq)).toBeNull();
  });

  it('purgeCache wipes everything', async () => {
    const { writeCache, readCache, purgeCache } = await import('../../src/data/cache.js');
    await writeCache(aaplReq, { candles: sampleCandles, fetchedAt: Date.now() });
    expect(await readCache(aaplReq)).not.toBeNull();
    await purgeCache();
    expect(await readCache(aaplReq)).toBeNull();
  });
});
