import { describe, expect, it } from 'vitest';
import { normalizeRawCandles } from '../../src/domain/dataset/normalizeRawCandles.js';

const candle = (timestamp: number, price = 100) => ({
  timestamp,
  open: price,
  high: price + 2,
  low: price - 2,
  close: price + 1,
  volume: 1_000,
});

describe('normalizeRawCandles', () => {
  it('returns a clone of valid second timestamps', () => {
    const input = [candle(1_700_000_000), candle(1_700_003_600, 101)];
    const result = normalizeRawCandles(input);

    expect(result).toEqual(input);
    expect(result).not.toBe(input);
    expect(result[0]).not.toBe(input[0]);
  });

  it('normalizes a uniform millisecond series to seconds', () => {
    const result = normalizeRawCandles([
      candle(1_700_000_000_000),
      candle(1_700_003_600_000, 101),
    ]);

    expect(result.map((item) => item.timestamp)).toEqual([1_700_000_000, 1_700_003_600]);
  });

  it('preserves fractional seconds when millisecond candles have sub-second precision', () => {
    const result = normalizeRawCandles([
      candle(1_700_000_000_500),
      candle(1_700_000_001_500, 101),
    ]);

    expect(result.map((item) => item.timestamp)).toEqual([1_700_000_000.5, 1_700_000_001.5]);
  });

  it('rejects mixed timestamp units', () => {
    expect(() => normalizeRawCandles([
      candle(1_700_000_000),
      candle(1_700_003_600_000),
    ])).toThrow(/mixed second and millisecond/i);
  });

  it.each([
    ['NaN open', { ...candle(1), open: Number.NaN }, /open.*finite/i],
    ['infinite high', { ...candle(1), high: Number.POSITIVE_INFINITY }, /high.*finite/i],
    ['negative volume', { ...candle(1), volume: -1 }, /volume.*negative/i],
    ['high below close', { ...candle(1), high: 100 }, /high.*greatest/i],
    ['low above open', { ...candle(1), low: 101 }, /low.*smallest/i],
  ])('rejects invalid %s', (_name, invalid, message) => {
    expect(() => normalizeRawCandles([invalid])).toThrow(message);
  });

  it('rejects duplicate and decreasing timestamps', () => {
    expect(() => normalizeRawCandles([candle(10), candle(10)])).toThrow(/strictly increasing/i);
    expect(() => normalizeRawCandles([candle(11), candle(10)])).toThrow(/strictly increasing/i);
  });

  it('rejects zero and negative timestamps', () => {
    expect(() => normalizeRawCandles([candle(0)])).toThrow(/positive/i);
    expect(() => normalizeRawCandles([candle(-1)])).toThrow(/positive/i);
  });
});
