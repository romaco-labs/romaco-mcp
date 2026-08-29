import type { Candle } from '../../compression/types.js';
import { normalizeRawCandles } from '../../domain/dataset/normalizeRawCandles.js';
import type { DataSource, LoadRequest } from '../types.js';

/**
 * Raw source — passthrough for user-provided OHLCV arrays.
 * Use case: user has their own data (CSV import, custom feed, testing).
 */
class RawSource implements DataSource {
  readonly name = 'raw' as const;

  async fetchCandles(req: LoadRequest): Promise<Candle[]> {
    const normalized = normalizeRawCandles(req.rawCandles ?? []);
    const lookback = req.lookback;
    return lookback ? normalized.slice(-lookback) : normalized;
  }
}

export const raw = new RawSource();
