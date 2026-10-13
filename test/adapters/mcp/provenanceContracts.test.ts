import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createTestClient } from '../../tools/_client.js';
import { session } from '../../../src/session.js';

function rawCandles(count: number, closeOffset = 0) {
  return Array.from({ length: count }, (_, index) => ({
    timestamp: 1_700_000_000 + index * 3_600,
    open: 100 + index * 0.1,
    high: 101 + index * 0.1,
    low: 99 + index * 0.1,
    close: 100.5 + index * 0.1 + closeOffset,
    volume: index === 0 ? 0 : 1_000 + index,
  }));
}

type Harness = Awaited<ReturnType<typeof createTestClient>>;
type Structured = Record<string, any>;

describe('provenance v1 output contracts', () => {
  let harness: Harness;

  beforeEach(async () => {
    session.clear();
    harness = await createTestClient();
  });

  afterEach(async () => {
    session.clear();
    await harness.close();
  });

  async function load(closeOffset = 0) {
    const before = Date.now();
    const response = await harness.callTool('romaco_load_candles', {
      source: 'raw',
      symbol: 'AAPL',
      timeframe: '1h',
      rawCandles: rawCandles(120, closeOffset),
    });
    const after = Date.now();
    return { dataset: (response.raw.structuredContent as Structured).data.dataset, before, after };
  }

  it('describes loaded data with hash, cut-off, last-bar availability and coverage', async () => {
    const { dataset, before, after } = await load();
    expect(dataset.provenance).toMatchObject({
      version: 1,
      datasetHash: expect.stringMatching(/^sha256:[0-9a-f]{64}$/),
      timezone: 'UTC',
      timestampUnit: 'unix_seconds',
      priceAdjustment: 'unknown',
      vintage: null,
      availableAtBasis: 'bar_open_plus_interval',
      lastBar: {
        observedAt: (1_700_000_000 + 119 * 3_600) * 1000,
        availableAt: (1_700_000_000 + 120 * 3_600) * 1000,
        complete: true,
      },
      coverage: { barCount: 120, zeroVolumeBars: 1 },
    });
    expect(dataset.provenance.asOf).toBe(dataset.fetchedAt);
    expect(dataset.provenance.asOf).toBeGreaterThanOrEqual(before);
    expect(dataset.provenance.asOf).toBeLessThanOrEqual(after);
  });

  it('gives identical data the same hash and changed data a different one', async () => {
    const first = await load();
    const same = await load();
    const changed = await load(0.01);
    expect(same.dataset.datasetId).not.toBe(first.dataset.datasetId);
    expect(same.dataset.provenance.datasetHash).toBe(first.dataset.provenance.datasetHash);
    expect(changed.dataset.provenance.datasetHash).not.toBe(first.dataset.provenance.datasetHash);
  });

  it('ties thesis and pattern results to the exact dataset hash and cut-off', async () => {
    const { dataset } = await load();
    const thesis = (await harness.callTool('romaco_thesis')).raw.structuredContent as Structured;
    const patterns = (await harness.callTool('romaco_detect_patterns')).raw.structuredContent as Structured;
    const expected = { datasetHash: dataset.provenance.datasetHash, asOf: dataset.provenance.asOf };
    expect(thesis.data.datasetId).toBe(dataset.datasetId);
    expect(thesis.data.dataProvenance).toEqual(expected);
    expect(patterns.data.dataProvenance).toEqual(expected);
  });
});
