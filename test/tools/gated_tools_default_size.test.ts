import { describe, it, expect, afterEach, beforeEach } from 'vitest';
import { createTestClient } from './_client.js';
import { session } from '../../src/session.js';

type Harness = Awaited<ReturnType<typeof createTestClient>>;

const SIZE_BUDGET_BYTES = 2000;

describe('gated tools — default (no ack) output stays under budget', () => {
  let h: Harness;

  beforeEach(async () => {
    session.clear();
    h = await createTestClient();
  });
  afterEach(async () => {
    await h.close();
  });

  it('romaco_get_chart_context: <2KB without ack', async () => {
    // No browser bridge connected in test → tool will error with "No chart connected".
    // That's the no-ack path: a small error message, which is well under budget.
    const res = await h.callTool('romaco_get_chart_context', {});
    expect(res.text.length).toBeLessThan(SIZE_BUDGET_BYTES);
  });

  it('romaco_get_visible_candles: <2KB without ack', async () => {
    const res = await h.callTool('romaco_get_visible_candles', {});
    expect(res.text.length).toBeLessThan(SIZE_BUDGET_BYTES);
  });

  it('romaco_get_indicator_values: <2KB without ack', async () => {
    const res = await h.callTool('romaco_get_indicator_values', { indicatorName: 'RSI' });
    expect(res.text.length).toBeLessThan(SIZE_BUDGET_BYTES);
  });

  it('romaco_capture_snapshot: refuses without ack and stays tiny', async () => {
    const res = await h.callTool('romaco_capture_snapshot', {});
    expect(res.isError).toBe(true);
    expect(res.text).toMatch(/acknowledgeHighTokenCost/);
    expect(res.text.length).toBeLessThan(SIZE_BUDGET_BYTES);
  });

  it('romaco_detect_patterns: <2KB without ack on realistic data', async () => {
    // Seed with synthetic candles so detect_patterns has data to scan
    const candles = Array.from({ length: 200 }, (_, i) => ({
      timestamp: 1_700_000_000 + i * 3600,
      open: 100 + Math.sin(i / 8) * 5,
      high: 100 + Math.sin(i / 8) * 5 + 0.5,
      low: 100 + Math.sin(i / 8) * 5 - 0.5,
      close: 100 + Math.sin(i / 8) * 5 + 0.1,
      volume: 1000,
    }));
    await h.callTool('romaco_load_candles', {
      source: 'raw',
      symbol: 'TEST',
      timeframe: '1h',
      rawCandles: candles,
    });
    const res = await h.callTool('romaco_detect_patterns', {});
    expect(res.isError).toBe(false);
    expect(res.text.length).toBeLessThan(SIZE_BUDGET_BYTES);
    // Must not include points[] arrays
    expect(res.text).not.toMatch(/"role"/);
    expect(res.text).not.toMatch(/"points":/);
  });
});
