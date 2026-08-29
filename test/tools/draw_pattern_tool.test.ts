import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createTestClient } from './_client.js';
import { bridge } from '../../src/bridge.js';
import { chartState } from '../../src/chartState.js';
import { session } from '../../src/session.js';
import { doubleTopCandles, headShouldersCandles } from '../compression/fixtures.js';
import type { LoadResponse } from '../../src/data/types.js';
import type { BridgeAction, BridgeAgentDrawingInput } from '../../src/types.js';

// Chart speaks milliseconds; the MCP session candles are unix seconds. The
// tool must sniff the mismatch and scale pattern timestamps ×1000.
const CHART_ANCHOR = 1_700_000_000_000;

function loadSession(candles: LoadResponse['candles'], symbol = 'TEST'): void {
  session.setLastLoad({ source: 'raw', symbol, timeframe: '1h', candles, fetched_at: Date.now() });
}

function allActions(): BridgeAction[] {
  return vi.mocked(bridge.executeAction).mock.calls.map((c) => c[0]);
}
function drawDrawings(): Array<BridgeAgentDrawingInput & { groupId: string }> {
  const replacement = allActions().find(
    (action): action is Extract<BridgeAction, { action: 'replaceAgentDrawingGroup' }> =>
      action.action === 'replaceAgentDrawingGroup',
  );
  return (replacement?.drawings ?? []).map((drawing) => ({
    ...drawing,
    groupId: replacement?.groupId ?? '',
  }));
}

const chartCandle = (timestamp: number, low = 90, high = 131) => ({
  timestamp,
  open: 100,
  high,
  low,
  close: 105,
  volume: 1_000,
});

beforeEach(() => {
  vi.spyOn(bridge, 'chartId', 'get').mockReturnValue('primary');
  vi.spyOn(bridge, 'getContext').mockResolvedValue({
    symbol: 'TEST',
    resolution: '1h',
    visibleCandles: [chartCandle(CHART_ANCHOR - 86_400_000), chartCandle(CHART_ANCHOR)],
  });
  vi.spyOn(bridge, 'executeAction').mockResolvedValue({ success: true });
});

afterEach(() => {
  chartState.clear();
  session.clear();
  vi.restoreAllMocks();
});

describe('romaco_draw_pattern', () => {
  it('draws a recent head & shoulders: family group replace first, geometry + trigger lines, journaled', async () => {
    loadSession(headShouldersCandles());
    const { callTool, close } = await createTestClient();
    try {
      const res = await callTool('romaco_draw_pattern', { kind: 'head_shoulders' });
      expect(res.isError).toBe(false);
      expect(res.text).toMatch(/Drew head_shoulders/);

      // Atomic family replace is the FIRST bridge action.
      expect(allActions()[0]).toMatchObject({
        action: 'replaceAgentDrawingGroup',
        groupId: 'romaco-mcp/pattern/hs',
      });

      const draws = drawDrawings();
      expect(draws.some((d) => d.drawingType === 'trendline')).toBe(true); // neckline
      expect(draws.some((d) => d.drawingType === 'path')).toBe(true); // silhouette
      expect(draws.some((d) => d.label === 'head_shoulders target')).toBe(true);
      expect(draws.some((d) => d.label === 'head_shoulders invalidation')).toBe(true);
      expect(draws.every((d) => d.groupId === 'romaco-mcp/pattern/hs')).toBe(true);

      // Unit sniff: every drawn timestamp is the pattern's session-second ts ×1000.
      for (const d of draws) {
        for (const p of d.points) {
          expect(p.timestamp).toBeGreaterThan(1e12);
          expect(p.timestamp % 1000).toBe(0);
        }
      }

      // Journaled as one atomic desired-state command for reconnect replay.
      const journal = chartState.snapshot();
      expect(journal.drawings).toHaveLength(0);
      expect(journal.drawingGroups).toHaveLength(1);
      expect(journal.drawingGroups[0].action).toMatchObject({
        action: 'replaceAgentDrawingGroup',
        groupId: 'romaco-mcp/pattern/hs',
        drawings: expect.arrayContaining(draws.map(({ action: _action, groupId: _groupId, ...drawing }) => drawing)),
      });
    } finally {
      await close();
    }
  });

  it('re-running replaces the family group instead of stacking journal entries', async () => {
    loadSession(headShouldersCandles());
    const { callTool, close } = await createTestClient();
    try {
      await callTool('romaco_draw_pattern', { kind: 'head_shoulders' });
      const afterFirst = chartState.snapshot().drawingGroups.length;
      await callTool('romaco_draw_pattern', { kind: 'head_shoulders' });
      expect(afterFirst).toBe(1);
      expect(chartState.snapshot().drawingGroups.length).toBe(1);
    } finally {
      await close();
    }
  });

  it('honest guard: a stale pattern (outside the recency window) draws nothing, not an error', async () => {
    // doubleTopCandles' second top sits just outside the final 25% of the series.
    loadSession(doubleTopCandles());
    const { callTool, close } = await createTestClient();
    try {
      const res = await callTool('romaco_draw_pattern', { kind: 'double_top' });
      expect(res.isError).toBe(false);
      expect(res.text).toMatch(/No recent double_top.*nothing drawn/);
      expect(allActions()).toHaveLength(0); // not even a group remove
    } finally {
      await close();
    }
  });

  it('refuses to draw when the chart shows a different symbol', async () => {
    loadSession(headShouldersCandles(), 'AAPL');
    vi.mocked(bridge.getContext).mockResolvedValue({
      symbol: 'NVDA',
      resolution: '1h',
      visibleCandles: [chartCandle(CHART_ANCHOR)],
    });
    const { callTool, close } = await createTestClient();
    try {
      const res = await callTool('romaco_draw_pattern', { kind: 'head_shoulders' });
      expect(res.isError).toBe(true);
      expect(res.text).toMatch(/NVDA.*AAPL|chart shows/i);
      expect(drawDrawings()).toHaveLength(0);
    } finally {
      await close();
    }
  });

  it('does not scale timestamps when the session already holds chart-unit (ms) candles', async () => {
    const msCandles = headShouldersCandles().map((c) => ({ ...c, timestamp: c.timestamp * 1000 }));
    loadSession(msCandles);
    const { callTool, close } = await createTestClient();
    try {
      const res = await callTool('romaco_draw_pattern', { kind: 'head_shoulders' });
      expect(res.isError).toBe(false);
      const draws = drawDrawings();
      expect(draws.length).toBeGreaterThan(0);
      const tsValues = msCandles.map((c) => c.timestamp);
      const min = Math.min(...tsValues);
      const max = Math.max(...tsValues);
      for (const d of draws.filter((x) => x.drawingType !== 'horizontalLine')) {
        for (const p of d.points) {
          expect(p.timestamp).toBeGreaterThanOrEqual(min);
          expect(p.timestamp).toBeLessThanOrEqual(max);
        }
      }
    } finally {
      await close();
    }
  });

  it('pins the Y range when the projected target falls outside the visible candles', async () => {
    loadSession(headShouldersCandles()); // target ≈ 70, below the fixture's lows
    vi.mocked(bridge.getContext).mockResolvedValue({
      symbol: 'TEST',
      resolution: '1h',
      visibleCandles: [
        chartCandle(CHART_ANCHOR - 86_400_000, 90, 131),
        chartCandle(CHART_ANCHOR, 92, 130),
      ],
    });
    const { callTool, close } = await createTestClient();
    try {
      const res = await callTool('romaco_draw_pattern', { kind: 'head_shoulders' });
      expect(res.isError).toBe(false);
      const pin = allActions().find(
        (a): a is Extract<BridgeAction, { action: 'setPriceRange' }> => a.action === 'setPriceRange',
      );
      expect(pin).toBeTruthy();
      expect(pin!.min).toBeLessThan(70); // target visible (with padding)
      expect(pin!.max).toBeGreaterThanOrEqual(131); // candles still visible
    } finally {
      await close();
    }
  });

  it('errors clearly when no candles are loaded', async () => {
    session.clear();
    const { callTool, close } = await createTestClient();
    try {
      const res = await callTool('romaco_draw_pattern', {});
      expect(res.isError).toBe(true);
      expect(res.text).toMatch(/load_candles/i);
    } finally {
      await close();
    }
  });

  it('errors with guidance when the chart bridge is not connected', async () => {
    loadSession(headShouldersCandles());
    vi.mocked(bridge.getContext).mockRejectedValue(
      new Error('No chart connected. Open the Romaco chart in your browser and add <McpBridge /> to your app.'),
    );
    const { callTool, close } = await createTestClient();
    try {
      const res = await callTool('romaco_draw_pattern', { kind: 'head_shoulders' });
      expect(res.isError).toBe(true);
      expect(res.text).toMatch(/McpBridge|No chart connected/i);
      expect(drawDrawings()).toHaveLength(0);
    } finally {
      await close();
    }
  });

  it('surfaces an enriched error and journals nothing when every draw fails', async () => {
    loadSession(headShouldersCandles());
    vi.mocked(bridge.executeAction).mockResolvedValue({ success: false, error: 'Chart not ready' });
    const { callTool, close } = await createTestClient();
    try {
      const res = await callTool('romaco_draw_pattern', { kind: 'head_shoulders' });
      expect(res.isError).toBe(true);
      expect(chartState.snapshot().drawings).toHaveLength(0);
    } finally {
      await close();
    }
  });
});
