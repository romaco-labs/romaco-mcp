import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import type { Candle } from '../compression/types.js';
import type { LoadRequest } from './types.js';

export interface CachedCandles {
  candles: Candle[];
  fetchedAt: number;
}

/**
 * Disk cache for fetched candles. Keyed by SHA1 of (source:symbol:timeframe:lookback)
 * with per-timeframe TTL (volatile bars expire quickly, daily/weekly hold longer).
 *
 * Honors ROMACO_CACHE_DIR env for tests + power users. Default ~/.romaco/cache.
 */

function cacheDir(): string {
  return process.env.ROMACO_CACHE_DIR ?? path.join(homedir(), '.romaco', 'cache');
}

const TTL_BY_TF: Record<string, number> = {
  '1m': 60_000,
  '2m': 2 * 60_000,
  '5m': 5 * 60_000,
  '15m': 15 * 60_000,
  '30m': 30 * 60_000,
  '1h': 60 * 60_000,
  '2h': 2 * 60 * 60_000,
  '4h': 4 * 60 * 60_000,
  '1d': 24 * 60 * 60_000,
  '5d': 5 * 24 * 60 * 60_000,
  '1w': 7 * 24 * 60 * 60_000,
  '1mo': 30 * 24 * 60 * 60_000,
  '3mo': 90 * 24 * 60 * 60_000,
};
const DEFAULT_TTL_MS = 60 * 60_000;

function ttlFor(tf: string): number {
  return TTL_BY_TF[tf] ?? DEFAULT_TTL_MS;
}

function cacheKey(req: LoadRequest): string {
  const norm = `${req.source}:${req.symbol}:${req.timeframe}:${req.lookback ?? 500}`;
  return createHash('sha1').update(norm).digest('hex');
}

function fileFor(req: LoadRequest): string {
  return path.join(cacheDir(), `${cacheKey(req)}.json`);
}

export async function readCache(req: LoadRequest): Promise<CachedCandles | null> {
  const file = fileFor(req);
  try {
    const raw = await fs.readFile(file, 'utf-8');
    const parsed: unknown = JSON.parse(raw);
    // Legacy array-only entries have no trustworthy acquisition time. Refetch.
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
    const entry = parsed as Record<string, unknown>;
    if (entry.version !== 1 || !Array.isArray(entry.candles)) return null;
    if (typeof entry.fetchedAt !== 'number' || !Number.isFinite(entry.fetchedAt)) return null;
    const age = Date.now() - entry.fetchedAt;
    if (entry.fetchedAt <= 0 || age < 0 || age > ttlFor(req.timeframe)) return null;
    return { candles: entry.candles as Candle[], fetchedAt: entry.fetchedAt };
  } catch {
    return null;
  }
}

export async function writeCache(req: LoadRequest, entry: CachedCandles): Promise<void> {
  await fs.mkdir(cacheDir(), { recursive: true });
  await fs.writeFile(fileFor(req), JSON.stringify({ version: 1, ...entry }));
}

/** Test/CLI helper. Wipes the entire cache dir; safe if it doesn't exist. */
export async function purgeCache(): Promise<void> {
  try {
    await fs.rm(cacheDir(), { recursive: true, force: true });
  } catch {
    /* ok */
  }
}
