import type { Candle } from '../../compression/types.js';

const MILLISECOND_TIMESTAMP_THRESHOLD = 100_000_000_000;

type TimestampUnit = 'seconds' | 'milliseconds';

function timestampUnit(timestamp: number): TimestampUnit {
  return timestamp >= MILLISECOND_TIMESTAMP_THRESHOLD ? 'milliseconds' : 'seconds';
}

function finiteField(
  candle: Record<string, unknown>,
  field: keyof Candle,
  index: number,
): number {
  const value = candle[field];
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new Error(`Invalid candle at index ${index}: ${field} must be a finite number.`);
  }
  return value;
}

/**
 * Validate external raw OHLCV input and normalize its timestamp unit to Unix
 * seconds. The entire input is checked before callers apply lookback slicing.
 */
export function normalizeRawCandles(input: readonly unknown[]): Candle[] {
  if (!Array.isArray(input) || input.length === 0) {
    throw new Error('source="raw" requires rawCandles array with at least one candle.');
  }

  let unit: TimestampUnit | null = null;
  let previousTimestamp = Number.NEGATIVE_INFINITY;

  return input.map((value, index) => {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
      throw new Error(`Invalid candle at index ${index}: expected an OHLCV object.`);
    }
    const candle = value as Record<string, unknown>;
    const rawTimestamp = finiteField(candle, 'timestamp', index);
    const open = finiteField(candle, 'open', index);
    const high = finiteField(candle, 'high', index);
    const low = finiteField(candle, 'low', index);
    const close = finiteField(candle, 'close', index);
    const volume = finiteField(candle, 'volume', index);

    if (rawTimestamp <= 0) {
      throw new Error(`Invalid candle at index ${index}: timestamp must be positive.`);
    }
    if (open < 0 || high < 0 || low < 0 || close < 0) {
      throw new Error(`Invalid candle at index ${index}: OHLC prices cannot be negative.`);
    }
    if (volume < 0) {
      throw new Error(`Invalid candle at index ${index}: volume cannot be negative.`);
    }
    if (high < Math.max(open, low, close)) {
      throw new Error(`Invalid candle at index ${index}: high must be the greatest OHLC value.`);
    }
    if (low > Math.min(open, high, close)) {
      throw new Error(`Invalid candle at index ${index}: low must be the smallest OHLC value.`);
    }

    const currentUnit = timestampUnit(rawTimestamp);
    if (unit !== null && currentUnit !== unit) {
      throw new Error('Invalid rawCandles: mixed second and millisecond timestamps are not allowed.');
    }
    unit = currentUnit;
    const timestamp = currentUnit === 'milliseconds' ? rawTimestamp / 1_000 : rawTimestamp;
    if (timestamp <= previousTimestamp) {
      throw new Error(`Invalid candle at index ${index}: timestamps must be strictly increasing.`);
    }
    previousTimestamp = timestamp;

    return { timestamp, open, high, low, close, volume };
  });
}
