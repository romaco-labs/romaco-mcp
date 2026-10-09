import { describe, expect, it } from 'vitest';
import { datasetDescriptorSchema, describeDataset } from '../../../src/adapters/inbound/mcp/outputSchemas.js';

const dataset = {
  datasetId: 'dataset-aapl',
  symbol: 'AAPL',
  timeframe: '1d' as const,
  source: 'yfinance' as const,
  candles: [{ timestamp: 1_700_000_000, close: 100 }],
  fetchedAt: 1_700_000_100_000,
};

describe('dataset provenance descriptor', () => {
  it('exposes acquisition and delivery separately for cached data', () => {
    const descriptor = describeDataset({
      ...dataset,
      servedAt: dataset.fetchedAt + 30_000,
      cacheHit: true,
    });
    expect(datasetDescriptorSchema.parse(descriptor)).toMatchObject({
      fetchedAt: dataset.fetchedAt,
      servedAt: dataset.fetchedAt + 30_000,
      cacheHit: true,
    });
  });

  it('marks legacy provenance unknown rather than claiming a cache miss', () => {
    const descriptor = describeDataset(dataset);
    expect(datasetDescriptorSchema.parse(descriptor)).toMatchObject({
      servedAt: null,
      cacheHit: null,
    });
  });
});
