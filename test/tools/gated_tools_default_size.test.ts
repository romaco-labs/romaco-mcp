import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { createTestClient } from './_client.js';
import { session } from '../../src/session.js';
import { bridge } from '../../src/bridge.js';

type Harness = Awaited<ReturnType<typeof createTestClient>>;

const SIZE_BUDGET_BYTES = 2000;

const visibleCandles = Array.from({ length: 500 }, (_, i) => ({
  timestamp: 1_700_000_000 + i * 60,
  open: 100 + i * 0.1,
  high: 100.5 + i * 0.1,
  low: 99.5 + i * 0.1,
  close: 100.2 + i * 0.1,
  volume: 1_000 + i,
}));

describe('gated tools — default (no ack) output stays under budget', () => {
  let h: Harness;

  beforeEach(async () => {
    session.clear();
    h = await createTestClient();
  });
  afterEach(async () => {
    await h.close();
    vi.restoreAllMocks();
  });

  it('romaco_get_chart_context: successful default payload stays <2KB', async () => {
    vi.spyOn(bridge, 'chartId', 'get').mockReturnValue('default');
    vi.spyOn(bridge, 'getContext').mockResolvedValue({
      visibleRange: { startTimestamp: 1, endTimestamp: 2, startIndex: 0, endIndex: 499 },
      visibleCandles,
      existingDrawings: new Array(30).fill({ id: 'd1', type: 'trendline', points: [{}, {}] }),
      existingIndicators: new Array(10).fill({ id: 'i1', name: 'RSI', params: [14], visible: true }),
      panels: [{ id: 'main', alias: 'main', indicators: [] }],
      currentPrice: 150.1,
      totalCandles: 500,
      zoomLevel: 1.2,
      renderBackend: 'webgpu',
      alerts: [{}, {}],
      paperTrading: null,
    });
    const res = await h.callTool('romaco_get_chart_context', {});
    expect(res.isError).toBe(false);
    expect(Buffer.byteLength(res.text, 'utf8')).toBeLessThan(SIZE_BUDGET_BYTES);
  });

  it('romaco_get_visible_candles: successful default payload stays <2KB', async () => {
    vi.spyOn(bridge, 'getContext').mockResolvedValue({ visibleCandles });
    const res = await h.callTool('romaco_get_visible_candles', {});
    expect(res.isError).toBe(false);
    expect(Buffer.byteLength(res.text, 'utf8')).toBeLessThan(SIZE_BUDGET_BYTES);
  });

  it('romaco_get_indicator_values: successful default payload stays <2KB', async () => {
    vi.spyOn(bridge, 'executeAction').mockResolvedValue({
      success: true,
      data: {
        name: 'RSI',
        params: [14],
        series: [{ key: 'value', values: Array.from({ length: 1_000 }, (_, i) => i % 100) }],
      },
    });
    const res = await h.callTool('romaco_get_indicator_values', { indicatorName: 'RSI' });
    expect(res.isError).toBe(false);
    expect(Buffer.byteLength(res.text, 'utf8')).toBeLessThan(SIZE_BUDGET_BYTES);
  });

  it('romaco_capture_snapshot: refuses without ack and stays tiny', async () => {
    const res = await h.callTool('romaco_capture_snapshot', {});
    expect(res.isError).toBe(true);
    expect(res.text).toMatch(/acknowledgeHighTokenCost/);
    expect(Buffer.byteLength(res.text, 'utf8')).toBeLessThan(SIZE_BUDGET_BYTES);
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
    expect(Buffer.byteLength(res.text, 'utf8')).toBeLessThan(SIZE_BUDGET_BYTES);
    // Must not include points[] arrays
    expect(res.text).not.toMatch(/"role"/);
    expect(res.text).not.toMatch(/"points":/);
  });
});
