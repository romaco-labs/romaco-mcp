import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createTestClient } from '../../tools/_client.js';
import { session } from '../../../src/session.js';

type Harness = Awaited<ReturnType<typeof createTestClient>>;

function rawCandles(count: number, volume: number) {
  return Array.from({ length: count }, (_, index) => ({
    timestamp: 1_700_000_000 + index * 86_400,
    open: 100 + Math.sin(index / 5) * 3,
    high: 102 + Math.sin(index / 5) * 3,
    low: 98 + Math.sin(index / 5) * 3,
    close: 100.5 + Math.sin(index / 5) * 3,
    volume,
  }));
}

describe('insufficient data in MCP outputs', () => {
  let harness: Harness;

  beforeEach(async () => {
    session.clear();
    harness = await createTestClient();
  });

  afterEach(async () => {
    session.clear();
    await harness.close();
  });

  it('reports null volume levels for data without volume across tools', async () => {
    await harness.callTool('romaco_load_candles', {
      source: 'raw', symbol: 'EURUSD', timeframe: '1d', rawCandles: rawCandles(120, 0),
    });
    const levels = JSON.parse((await harness.callTool('romaco_find_levels')).text);
    expect(levels).toMatchObject({ poc: null, vah: null, val: null, volume_status: 'insufficient' });

    const summary = JSON.parse((await harness.callTool('romaco_analyze_market')).text);
    expect(summary.levels).toMatchObject({ poc: null, volume_status: 'insufficient' });

    const thesis = await harness.callTool('romaco_thesis');
    expect(thesis.isError).toBe(false);
    const factors = JSON.stringify((thesis.raw.structuredContent as any).data.thesis);
    expect(factors).not.toMatch(/above_poc|below_poc/);
  });

  it('stands aside with an explicit reason on too few candles', async () => {
    await harness.callTool('romaco_load_candles', {
      source: 'raw', symbol: 'SHORT', timeframe: '1d', rawCandles: rawCandles(20, 1_000),
    });
    const summary = JSON.parse((await harness.callTool('romaco_analyze_market')).text);
    expect(summary.momentum).toMatchObject({ macd_cross: 'insufficient_data', macd_histogram: null });

    const thesis = await harness.callTool('romaco_thesis');
    const data = (thesis.raw.structuredContent as any).data.thesis;
    expect(data.verdict).toBe('stand_aside');
    expect(data.notes[0]).toMatch(/^insufficient data: 20 candles/);
  });
});
