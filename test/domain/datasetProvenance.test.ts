import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { InMemoryDatasetRepository } from '../../src/adapters/outbound/persistence/InMemoryDatasetRepository.js';
import {
  barAvailableAt,
  canonicalDatasetContent,
  describeProvenance,
} from '../../src/domain/dataset/provenance.js';

const HOUR = 3_600;
const T0 = 1_700_000_000;

function candles(count: number, volume = (index: number) => 1_000 + index) {
  return Array.from({ length: count }, (_, index) => ({
    timestamp: T0 + index * HOUR,
    open: 100 + index,
    high: 101 + index,
    low: 99 + index,
    close: 100.5 + index,
    volume: volume(index),
  }));
}

const base = { source: 'yfinance' as const, symbol: 'AAPL', timeframe: '1h' as const };

describe('dataset provenance v1', () => {
  it('hashes the same content identically and any OHLCV change differently', () => {
    const a = canonicalDatasetContent({ ...base, candles: candles(3) });
    const b = canonicalDatasetContent({ ...base, candles: candles(3) });
    const changed = candles(3);
    changed[1] = { ...changed[1], close: changed[1].close + 0.01 };
    expect(a).toBe(b);
    expect(canonicalDatasetContent({ ...base, candles: changed })).not.toBe(a);
    expect(canonicalDatasetContent({ ...base, symbol: 'MSFT', candles: candles(3) })).not.toBe(a);
    expect(canonicalDatasetContent({ ...base, timeframe: '2h', candles: candles(3) })).not.toBe(a);
  });

  it('uses acquisition time as asOf, not delivery time', () => {
    const fetchedAt = (T0 + 10 * HOUR) * 1000;
    const provenance = describeProvenance({ ...base, candles: candles(3), fetchedAt }, 'sha256:x');
    expect(provenance.asOf).toBe(fetchedAt);
  });

  it('marks the last bar complete only after its upper-bound close', () => {
    const bars = candles(3);
    const lastOpenMs = bars[2].timestamp * 1000;
    const forming = describeProvenance({ ...base, candles: bars, fetchedAt: lastOpenMs + 30 * 60_000 }, 'sha256:x');
    expect(forming.lastBar).toEqual({
      observedAt: lastOpenMs,
      availableAt: lastOpenMs + HOUR * 1000,
      complete: false,
    });
    const closed = describeProvenance({ ...base, candles: bars, fetchedAt: lastOpenMs + HOUR * 1000 }, 'sha256:x');
    expect(closed.lastBar?.complete).toBe(true);
  });

  it('adds calendar months for monthly and quarterly bars', () => {
    expect(barAvailableAt(Date.UTC(2026, 0, 1) / 1000, '1mo')).toBe(Date.UTC(2026, 1, 1));
    expect(barAvailableAt(Date.UTC(2026, 0, 1) / 1000, '3mo')).toBe(Date.UTC(2026, 3, 1));
    expect(barAvailableAt(T0, '5d')).toBe((T0 + 7 * 86_400) * 1000);
  });

  it('reports coverage, zero-volume bars and source adjustment', () => {
    const bars = candles(4, (index) => (index % 2 === 0 ? 0 : 500));
    const provenance = describeProvenance({ ...base, candles: bars, fetchedAt: Date.now() }, 'sha256:x');
    expect(provenance.coverage).toEqual({
      barCount: 4,
      firstObservedAt: T0 * 1000,
      lastObservedAt: (T0 + 3 * HOUR) * 1000,
      zeroVolumeBars: 2,
    });
    expect(provenance).toMatchObject({
      version: 1,
      timezone: 'UTC',
      timestampUnit: 'unix_seconds',
      priceAdjustment: 'splits',
      vintage: null,
      availableAtBasis: 'bar_open_plus_interval',
    });
    const raw = describeProvenance({ ...base, source: 'raw', candles: bars, fetchedAt: 0 }, 'sha256:x');
    expect(raw.priceAdjustment).toBe('unknown');
  });

  it('describes an empty dataset without inventing bars', () => {
    const provenance = describeProvenance({ ...base, candles: [], fetchedAt: 1 }, 'sha256:x');
    expect(provenance.lastBar).toBeNull();
    expect(provenance.coverage).toEqual({
      barCount: 0, firstObservedAt: null, lastObservedAt: null, zeroVolumeBars: 0,
    });
  });

  it('stores a frozen sha256 provenance with every saved dataset', async () => {
    const repository = new InMemoryDatasetRepository(() => 'fixed');
    const bars = candles(5);
    const record = await repository.save({ ...base, candles: bars, fetchedAt: 123 });
    const expected = createHash('sha256').update(canonicalDatasetContent({ ...base, candles: bars })).digest('hex');
    expect(record.provenance.datasetHash).toBe(`sha256:${expected}`);
    expect(record.provenance.asOf).toBe(123);
    expect(Object.isFrozen(record.provenance)).toBe(true);
    expect(Object.isFrozen(record.provenance.coverage)).toBe(true);
    expect(Object.isFrozen(record.provenance.lastBar)).toBe(true);
  });
});
