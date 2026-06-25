import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createTestClient } from './_client.js';
import { bridge } from '../../src/bridge.js';
import { chartState } from '../../src/chartState.js';
import { session } from '../../src/session.js';
import { uptrendCandles, sidewaysCandles } from '../compression/fixtures.js';
import { analyzeSession } from '../../src/compression/analyze.js';
import type { LoadResponse } from '../../src/data/types.js';
import type { BridgeAction } from '../../src/types.js';

// The chart's timestamp unit (ms here) is deliberately DIFFERENT from the MCP
// session candle unit (yfinance seconds). annotate must anchor on the chart's
// visible candle so the box lands in-range — this constant is what we assert.
const CHART_ANCHOR = 1_700_000_000_000;

function loadSession(candles: LoadResponse['candles']): void {
  session.setLastLoad({ source: 'raw', symbol: 'TEST', timeframe: '1d', candles, fetched_at: Date.now() });
}

/** Every action annotate sent to the (mocked) bridge, in order. */
function allActions(): BridgeAction[] {
  return vi.mocked(bridge.executeAction).mock.calls.map((c) => c[0]);
}
function drawDrawings(): Array<Extract<BridgeAction, { action: 'addDrawing' }>> {
  return allActions().filter((a): a is Extract<BridgeAction, { action: 'addDrawing' }> => a.action === 'addDrawing');
}
const isPositionBox = (t: string): boolean => /Position$/.test(t); // longPosition | shortPosition

beforeEach(() => {
  vi.spyOn(bridge, 'getContext').mockResolvedValue({
    visibleCandles: [{ timestamp: CHART_ANCHOR - 86_400_000 }, { timestamp: CHART_ANCHOR }],
  });
  vi.spyOn(bridge, 'executeAction').mockResolvedValue({ success: true });
});

afterEach(() => {
  chartState.clear();
  session.clear();
  vi.restoreAllMocks();
});

describe('romaco_annotate (stage 2)', () => {
  it('setup: dedups, then draws faint context + the bold position box under one group', async () => {
    const candles = uptrendCandles(220, 100, 0.6);
    loadSession(candles);
    const { thesis } = analyzeSession(candles);
    expect(thesis.setup, 'fixture should yield a setup').not.toBeNull();

    const { callTool, close } = await createTestClient();
    try {
      const res = await callTool('romaco_annotate', {});
      expect(res.isError).toBe(false);

      // Group-scoped replace is the FIRST bridge action.
      expect(allActions()[0]).toMatchObject({ action: 'removeDrawingsByGroup', groupId: 'romaco-thesis' });

      const draws = drawDrawings();
      // Bold action box, exact entry/stop/target order.
      const box = draws.find((d) => isPositionBox(d.drawingType));
      expect(box).toBeTruthy();
      expect(box!.points.map((p) => p.price)).toEqual([
        thesis.setup!.entry,
        thesis.setup!.stop,
        thesis.setup!.target,
      ]);
      // Faint context levels (low opacity).
      const levels = draws.filter((d) => d.drawingType === 'horizontalLine');
      expect(levels.length).toBeGreaterThan(0);
      expect(levels.every((l) => (l.style?.opacity ?? 1) <= 0.4)).toBe(true);
      // Entry-zone band.
      expect(draws.some((d) => d.drawingType === 'rectangle')).toBe(true);
      // Everything under the one group, and journaled for replay.
      expect(draws.every((d) => d.groupId === 'romaco-thesis')).toBe(true);
      expect(chartState.snapshot().drawings.length).toBe(draws.length);
    } finally {
      await close();
    }
  });

  it('anchors the box X on the chart visible candles (zone-left, ~20 bars back), not the MCP session unit (C1)', async () => {
    loadSession(uptrendCandles(220, 100, 0.6));
    const { callTool, close } = await createTestClient();
    try {
      await callTool('romaco_annotate', {});
      const box = drawDrawings().find((d) => isPositionBox(d.drawingType))!;
      // Anchored ~20 bars back so the box overlaps visible candles instead of
      // hanging off the right edge. With a 2-candle mock, zone-left = vc[0].
      const ZONE_LEFT = CHART_ANCHOR - 86_400_000;
      expect(box.points.every((p) => p.timestamp === ZONE_LEFT)).toBe(true);
    } finally {
      await close();
    }
  });

  it('honest guard: stand_aside draws only context, never a setup', async () => {
    const candles = sidewaysCandles(220, 100, 1);
    loadSession(candles);
    const { thesis } = analyzeSession(candles);
    expect(thesis.verdict).toBe('stand_aside');

    const { callTool, close } = await createTestClient();
    try {
      const res = await callTool('romaco_annotate', {});
      expect(res.isError).toBe(false);
      const draws = drawDrawings();
      expect(draws.some((d) => isPositionBox(d.drawingType))).toBe(false); // no entry/stop/target box
      expect(draws.some((d) => d.drawingType === 'rectangle')).toBe(false); // no entry zone
      expect(res.text).toMatch(/standing aside/i);
    } finally {
      await close();
    }
  });

  it('errors clearly when no candles are loaded', async () => {
    session.clear();
    const { callTool, close } = await createTestClient();
    try {
      const res = await callTool('romaco_annotate', {});
      expect(res.isError).toBe(true);
      expect(res.text).toMatch(/load_candles/i);
    } finally {
      await close();
    }
  });

  it('errors with guidance when the chart bridge is not connected', async () => {
    loadSession(uptrendCandles(220, 100, 0.6));
    vi.mocked(bridge.getContext).mockRejectedValue(
      new Error('No chart connected. Open the Romaco chart in your browser and add <McpBridge /> to your app.'),
    );
    const { callTool, close } = await createTestClient();
    try {
      const res = await callTool('romaco_annotate', {});
      expect(res.isError).toBe(true);
      expect(res.text).toMatch(/McpBridge|No chart connected/i);
      expect(drawDrawings()).toHaveLength(0);
    } finally {
      await close();
    }
  });

  it('surfaces an error and journals nothing when the position box fails to draw', async () => {
    loadSession(uptrendCandles(220, 100, 0.6));
    vi.mocked(bridge.executeAction).mockResolvedValue({ success: false, error: 'Chart not ready' });
    const { callTool, close } = await createTestClient();
    try {
      const res = await callTool('romaco_annotate', {});
      expect(res.isError).toBe(true);
      expect(chartState.snapshot().drawings).toHaveLength(0);
    } finally {
      await close();
    }
  });
});
