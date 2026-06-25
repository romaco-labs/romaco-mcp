import { describe, it, expect } from 'vitest';
import { raw } from '../../src/data/sources/raw.js';
import type { Candle } from '../../src/compression/types.js';

const validCandle = (ts: number, p: number): Candle => ({
  timestamp: ts, open: p, high: p + 1, low: p - 1, close: p, volume: 1000,
});

describe('raw source', () => {
  it('passes through valid candles', async () => {
    const candles = [validCandle(1, 100), validCandle(2, 101), validCandle(3, 102)];
    const result = await raw.fetchCandles({ source: 'raw', symbol: 'TEST', timeframe: '1h', rawCandles: candles });
    expect(result).toEqual(candles);
  });

  it('respects lookback limit', async () => {
    const candles = Array.from({ length: 10 }, (_, i) => validCandle(i, 100 + i));
    const result = await raw.fetchCandles({ source: 'raw', symbol: 'TEST', timeframe: '1h', rawCandles: candles, lookback: 3 });
    expect(result.length).toBe(3);
    expect(result[0].timestamp).toBe(7);
  });

  it('throws on missing rawCandles', async () => {
    await expect(raw.fetchCandles({ source: 'raw', symbol: 'TEST', timeframe: '1h' })).rejects.toThrow(/requires rawCandles/);
  });

  it('throws on empty rawCandles', async () => {
    await expect(raw.fetchCandles({ source: 'raw', symbol: 'TEST', timeframe: '1h', rawCandles: [] })).rejects.toThrow(/requires rawCandles/);
  });

  it('throws on invalid candle shape', async () => {
    const bad = [{ timestamp: 1, open: 100, high: 101, low: 99 }] as unknown as Candle[];
    await expect(raw.fetchCandles({ source: 'raw', symbol: 'TEST', timeframe: '1h', rawCandles: bad })).rejects.toThrow(/Invalid candle/);
  });
});
