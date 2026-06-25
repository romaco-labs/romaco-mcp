import { describe, it, expect, afterEach, beforeEach } from 'vitest';
import { createTestClient } from './_client.js';
import { session } from '../../src/session.js';

type Harness = Awaited<ReturnType<typeof createTestClient>>;

function makeRaw(n: number) {
  return Array.from({ length: n }, (_, i) => ({
    timestamp: 1_700_000_000 + i * 3600,
    open: 100,
    high: 100.5,
    low: 99.5,
    close: 100.2,
    volume: 1000,
  }));
}

describe('romaco_load_candles — session clears on failure (B3)', () => {
  let h: Harness;

  beforeEach(async () => {
    session.clear();
    h = await createTestClient();
  });
  afterEach(async () => {
    await h.close();
  });

  it('preserves session on successful load', async () => {
    const res = await h.callTool('romaco_load_candles', {
      source: 'raw',
      symbol: 'OK',
      timeframe: '1h',
      rawCandles: makeRaw(50),
    });
    expect(res.isError).toBe(false);
    expect(session.getLastLoad()?.symbol).toBe('OK');
  });

  it('preserves session when raw load fails with empty array', async () => {
    // 1. seed session with a valid load
    await h.callTool('romaco_load_candles', {
      source: 'raw',
      symbol: 'SEED',
      timeframe: '1h',
      rawCandles: makeRaw(50),
    });
    expect(session.getLastLoad()?.symbol).toBe('SEED');

    // 2. failed load should NOT clear the previous session
    const fail = await h.callTool('romaco_load_candles', {
      source: 'raw',
      symbol: 'BAD',
      timeframe: '1h',
      rawCandles: [],
    });
    expect(fail.isError).toBe(true);
    expect(fail.text).toMatch(/Previous session state preserved/);

    // Session still holds the last successful load
    expect(session.getLastLoad()?.symbol).toBe('SEED');
  });

  it('subsequent analysis call succeeds using last valid session after failed load', async () => {
    // seed
    await h.callTool('romaco_load_candles', {
      source: 'raw',
      symbol: 'SEED',
      timeframe: '1h',
      rawCandles: makeRaw(50),
    });

    // fail
    await h.callTool('romaco_load_candles', {
      source: 'raw',
      symbol: 'BAD',
      timeframe: '1h',
      rawCandles: [],
    });

    // analyze should succeed because the previous session is preserved
    const analyze = await h.callTool('romaco_analyze_market', {});
    expect(analyze.isError).toBeFalsy();
  });
});
