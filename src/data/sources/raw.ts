import type { Candle } from '../../compression/types.js';
import type { DataSource, LoadRequest } from '../types.js';

/**
 * Raw source — passthrough for user-provided OHLCV arrays.
 * Use case: user has their own data (CSV import, custom feed, testing).
 */
class RawSource implements DataSource {
  readonly name = 'raw' as const;

  async fetchCandles(req: LoadRequest): Promise<Candle[]> {
    if (!req.rawCandles || req.rawCandles.length === 0) {
      throw new Error('source="raw" requires rawCandles array');
    }

    // Validate each candle has required fields
    for (let i = 0; i < req.rawCandles.length; i++) {
      const c = req.rawCandles[i];
      if (
        typeof c.timestamp !== 'number' ||
        typeof c.open !== 'number' ||
        typeof c.high !== 'number' ||
        typeof c.low !== 'number' ||
        typeof c.close !== 'number'
      ) {
        throw new Error(`Invalid candle at index ${i}: missing required OHLC fields`);
      }
    }

    const lookback = req.lookback;
    return lookback ? req.rawCandles.slice(-lookback) : req.rawCandles;
  }
}

export const raw = new RawSource();
