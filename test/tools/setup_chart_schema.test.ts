import { describe, it, expect, afterEach, beforeEach } from 'vitest';
import { createTestClient } from './_client.js';
import { session } from '../../src/session.js';

type Harness = Awaited<ReturnType<typeof createTestClient>>;

describe('romaco_setup_chart — rawCandles support (B1)', () => {
  let h: Harness;

  beforeEach(async () => {
    session.clear();
    h = await createTestClient();
  });
  afterEach(async () => {
    await h.close();
  });

  it('schema declares rawCandles as optional array', async () => {
    const tools = await h.client.listTools();
    const tool = tools.tools.find((t) => t.name === 'romaco_setup_chart');
    expect(tool).toBeTruthy();

    const schema = tool!.inputSchema as { properties?: Record<string, { type?: string }> };
    expect(schema.properties).toBeTruthy();
    expect(schema.properties!.rawCandles).toBeTruthy();
    expect(schema.properties!.rawCandles.type).toBe('array');
  });

  it('source="raw" with rawCandles succeeds (no validation error)', async () => {
    const rawCandles = Array.from({ length: 80 }, (_, i) => ({
      timestamp: 1_700_000_000 + i * 3600,
      open: 100 + i * 0.1,
      high: 100.5 + i * 0.1,
      low: 99.5 + i * 0.1,
      close: 100.2 + i * 0.1,
      volume: 1000 + i,
    }));

    const res = await h.callTool('romaco_setup_chart', {
      symbol: 'TEST',
      timeframe: '1h',
      source: 'raw',
      lookback: 80,
      rawCandles,
    });

    expect(res.isError).toBe(false);
    expect(res.text).toMatch(/Loaded 80 candles/);
    expect(res.text).toMatch(/TEST/);
  });

  it('source="raw" without rawCandles still errors (pre-existing behavior preserved)', async () => {
    const res = await h.callTool('romaco_setup_chart', {
      symbol: 'TEST',
      timeframe: '1h',
      source: 'raw',
      lookback: 50,
    });

    expect(res.isError).toBe(true);
    expect(res.text).toMatch(/rawCandles/i);
  });
});
