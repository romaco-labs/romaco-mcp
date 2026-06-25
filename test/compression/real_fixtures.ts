import { readFileSync } from 'node:fs';
import type { Candle } from '../../src/compression/types.js';

/**
 * Loader for the recorded real-market fixtures (test/fixtures/real/).
 * Each call parses a FRESH array — callers relying on array identity
 * (the scan memo) must hold on to the reference they got.
 */
export function realCandles(symbol: string): Candle[] {
  const url = new URL(`../fixtures/real/${symbol}_1d_400.json`, import.meta.url);
  return JSON.parse(readFileSync(url, 'utf-8')) as Candle[];
}
