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
    const candles = Array.from({ length: 10 }, (_, i) => validCandle(i + 1, 100 + i));
    const result = await raw.fetchCandles({ source: 'raw', symbol: 'TEST', timeframe: '1h', rawCandles: candles, lookback: 3 });
    expect(result.length).toBe(3);
    expect(result[0].timestamp).toBe(8);
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

  it('validates the full input before applying lookback', async () => {
    const badFirst = { ...validCandle(1, 100), volume: -1 };
    const candles = [badFirst, validCandle(2, 101), validCandle(3, 102)];

    await expect(raw.fetchCandles({
      source: 'raw',
      symbol: 'TEST',
      timeframe: '1h',
      rawCandles: candles,
      lookback: 1,
    })).rejects.toThrow(/volume/i);
  });

  it('normalizes millisecond timestamps before slicing', async () => {
    const result = await raw.fetchCandles({
      source: 'raw',
      symbol: 'TEST',
      timeframe: '1h',
      rawCandles: [validCandle(1_700_000_000_000, 100), validCandle(1_700_003_600_000, 101)],
      lookback: 1,
    });

    expect(result).toHaveLength(1);
    expect(result[0].timestamp).toBe(1_700_003_600);
  });
});
