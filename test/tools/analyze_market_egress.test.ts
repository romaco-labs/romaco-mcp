import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createTestClient } from './_client.js';
import { session } from '../../src/session.js';

const savedToken = process.env.ROMACO_TOKEN;

describe('romaco_analyze_market remote egress policy', () => {
  beforeEach(() => {
    session.clear();
    process.env.ROMACO_TOKEN = 'configured-but-not-authorized';
  });

  afterEach(() => {
    session.clear();
    vi.restoreAllMocks();
    if (savedToken === undefined) delete process.env.ROMACO_TOKEN;
    else process.env.ROMACO_TOKEN = savedToken;
  });

  it('computes locally and never calls fetch when a token is present', async () => {
    const fetchMock = vi.fn(async () => { throw new Error('network must remain unused'); });
    vi.stubGlobal('fetch', fetchMock);
    const harness = await createTestClient();
    try {
      const candles = Array.from({ length: 100 }, (_, index) => ({
        timestamp: 1_700_000_000 + index * 3_600,
        open: 100 + index * 0.1,
        high: 101 + index * 0.1,
        low: 99 + index * 0.1,
        close: 100.5 + index * 0.1,
        volume: 1_000,
      }));
      await harness.callTool('romaco_load_candles', {
        source: 'raw', symbol: 'LOCAL', timeframe: '1h', rawCandles: candles,
      });
      const result = await harness.callTool('romaco_analyze_market');
      expect(result.isError).toBe(false);
      expect(JSON.parse(result.text)).toMatchObject({ meta: { candle_count: 100 } });
      expect(fetchMock).not.toHaveBeenCalled();
    } finally {
      await harness.close();
    }
  });
});
