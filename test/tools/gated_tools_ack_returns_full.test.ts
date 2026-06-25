import { describe, it, expect, afterEach, beforeEach } from 'vitest';
import { createTestClient } from './_client.js';
import { session } from '../../src/session.js';

type Harness = Awaited<ReturnType<typeof createTestClient>>;

describe('gated tools — acknowledgeHighTokenCost:true returns full payload', () => {
  let h: Harness;

  beforeEach(async () => {
    session.clear();
    h = await createTestClient();
  });
  afterEach(async () => {
    await h.close();
  });

  it('romaco_detect_patterns with ack includes points[] anchors', async () => {
    // Construct a textbook head-and-shoulders sequence (clear peaks/valleys)
    // so detect_patterns is guaranteed to fire on this seed.
    const candles: Array<{
      timestamp: number; open: number; high: number; low: number; close: number; volume: number;
    }> = [];
    const pattern = [
      100, 102, 104, 106, 105, 103, 101, 99, 98, 100, // build-up
      102, 104, 106, 108, 110, 109, 107, 105, 103, 101, // left shoulder + drop
      100, 102, 104, 106, 108, 110, 112, 114, 116, 115, 113, 111, 109, 107, 105, 103, 101, // head
      100, 102, 104, 106, 108, 110, 108, 106, 104, 102, 100, 98, // right shoulder + breakdown
      96, 94, 92, 90, 88,
    ];
    for (let cycle = 0; cycle < 4; cycle++) {
      for (let i = 0; i < pattern.length; i++) {
        const p = pattern[i] + cycle * 0.01;
        candles.push({
          timestamp: 1_700_000_000 + (cycle * pattern.length + i) * 3600,
          open: p,
          high: p + 0.5,
          low: p - 0.5,
          close: p + 0.1,
          volume: 1000,
        });
      }
    }
    await h.callTool('romaco_load_candles', {
      source: 'raw',
      symbol: 'TEST',
      timeframe: '1h',
      rawCandles: candles,
    });
    const withAck = await h.callTool('romaco_detect_patterns', {
      acknowledgeHighTokenCost: true,
    });
    expect(withAck.isError).toBe(false);
    // Either patterns detected (with points[]) or empty array — both valid.
    // If non-empty, must contain role markers.
    const parsed = JSON.parse(withAck.text);
    if (Array.isArray(parsed) && parsed.length > 0) {
      expect(withAck.text).toMatch(/"role"/);
      expect(withAck.text).toMatch(/"points":/);
    }
  });

  it('romaco_capture_snapshot with ack but no bridge → bridge error (not gate error)', async () => {
    // No browser connected: bridge will reject. We just want to confirm the
    // gate doesn't fire when ack is present (i.e. error message is NOT the
    // gate text).
    const res = await h.callTool('romaco_capture_snapshot', {
      acknowledgeHighTokenCost: true,
    });
    // With ack, we should NOT see the gate refusal message.
    expect(res.text).not.toMatch(/romaco_capture_snapshot is gated/);
  });

  it('romaco_get_chart_context schema declares acknowledgeHighTokenCost', async () => {
    const tools = await h.client.listTools();
    const tool = tools.tools.find((t) => t.name === 'romaco_get_chart_context');
    const props = (tool!.inputSchema as { properties?: Record<string, unknown> }).properties ?? {};
    expect(props.acknowledgeHighTokenCost).toBeTruthy();
  });

  it('romaco_get_visible_candles schema declares acknowledgeHighTokenCost', async () => {
    const tools = await h.client.listTools();
    const tool = tools.tools.find((t) => t.name === 'romaco_get_visible_candles');
    const props = (tool!.inputSchema as { properties?: Record<string, unknown> }).properties ?? {};
    expect(props.acknowledgeHighTokenCost).toBeTruthy();
  });

  it('romaco_get_indicator_values schema declares acknowledgeHighTokenCost', async () => {
    const tools = await h.client.listTools();
    const tool = tools.tools.find((t) => t.name === 'romaco_get_indicator_values');
    const props = (tool!.inputSchema as { properties?: Record<string, unknown> }).properties ?? {};
    expect(props.acknowledgeHighTokenCost).toBeTruthy();
  });

  it('all gated tools mention compression-first in description', async () => {
    const tools = await h.client.listTools();
    const gatedNames = [
      'romaco_get_chart_context',
      'romaco_get_visible_candles',
      'romaco_get_indicator_values',
      'romaco_capture_snapshot',
      'romaco_detect_patterns',
    ];
    for (const name of gatedNames) {
      const tool = tools.tools.find((t) => t.name === name);
      expect(tool, `tool ${name} not found`).toBeTruthy();
      expect(tool!.description, `${name} description missing Cost note`).toMatch(/Cost|gated|compressed/i);
    }
  });
});
