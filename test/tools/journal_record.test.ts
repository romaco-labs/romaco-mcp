import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createTestClient } from './_client.js';
import { bridge } from '../../src/bridge.js';
import { chartState } from '../../src/chartState.js';
import { createChartId } from '../../src/domain/chart/model.js';

const AAPL_DAILY = {
  chartId: createChartId('primary'), symbol: 'AAPL', timeframe: '1d' as const,
};

// The mutating tools call the global `bridge` singleton. Stub it to "succeed"
// without a real browser so we can assert the journal side-effect.
beforeEach(() => {
  vi.spyOn(bridge, 'executeAction').mockResolvedValue({ success: true });
  vi.spyOn(bridge, 'chartId', 'get').mockReturnValue('primary');
  vi.spyOn(bridge, 'getContext').mockResolvedValue({ symbol: 'AAPL', resolution: '1d' });
});

afterEach(() => {
  chartState.clear();
  vi.restoreAllMocks();
});

describe('mutating tools record into the chartState journal', () => {
  it('romaco_add_indicator records the indicator on success', async () => {
    const { callTool, close } = await createTestClient();
    try {
      const res = await callTool('romaco_add_indicator', { indicatorType: 'EMA', params: [20] });
      expect(res.isError).toBe(false);
      const snap = chartState.snapshot();
      expect(snap.indicators).toHaveLength(1);
      expect(snap.indicators[0].action).toEqual({ action: 'addIndicator', indicatorType: 'EMA', params: [20] });
    } finally {
      await close();
    }
  });

  it('romaco_clear_drawings empties the drawings bucket', async () => {
    chartState.recordDrawing(
      { action: 'addDrawing', drawingType: 'trendline', points: [{ timestamp: 1, price: 10 }, { timestamp: 2, price: 20 }] },
      AAPL_DAILY,
    );
    const { callTool, close } = await createTestClient();
    try {
      await callTool('romaco_clear_drawings', {});
      expect(chartState.snapshot().drawings).toHaveLength(0);
    } finally {
      await close();
    }
  });

  it('romaco_add_drawing embeds and records complete live identity', async () => {
    const { callTool, close } = await createTestClient();
    try {
      const res = await callTool('romaco_add_drawing', {
        drawingType: 'horizontalLine',
        points: [{ timestamp: 1_000, price: 100 }],
      });

      expect(res.isError).toBe(false);
      expect(chartState.snapshot().drawings[0].identity).toEqual(AAPL_DAILY);
      expect(bridge.executeAction).toHaveBeenCalledWith(expect.objectContaining({
        action: 'addDrawing',
        expectedIdentity: { chartId: 'primary', symbol: 'AAPL', resolution: '1d' },
      }));
    } finally {
      await close();
    }
  });

  it('does not record when the bridge action fails', async () => {
    vi.spyOn(bridge, 'executeAction').mockResolvedValue({ success: false, error: 'Chart not ready' });
    const { callTool, close } = await createTestClient();
    try {
      const res = await callTool('romaco_add_indicator', { indicatorType: 'RSI', params: [14] });
      expect(res.isError).toBe(true);
      expect(chartState.snapshot().indicators).toHaveLength(0);
    } finally {
      await close();
    }
  });

  it('records browser resource ids for exact later removal', async () => {
    vi.mocked(bridge.executeAction)
      .mockResolvedValueOnce({ success: true, data: { indicatorId: 'ema-20' } })
      .mockResolvedValueOnce({ success: true, data: { alert: { id: 'alert-1' } } });
    const { callTool, close } = await createTestClient();
    try {
      await callTool('romaco_add_indicator', { indicatorType: 'EMA', params: [20] });
      await callTool('romaco_add_alert', { price: 100, direction: 'above' });

      expect(chartState.snapshot().indicators[0].resourceId).toBe('ema-20');
      expect(chartState.snapshot().alerts[0].resourceId).toBe('alert-1');
      expect(chartState.snapshot().alerts[0].identity).toEqual(AAPL_DAILY);
      expect(vi.mocked(bridge.executeAction).mock.calls[1][0]).toMatchObject({
        expectedIdentity: { chartId: 'primary', symbol: 'AAPL', resolution: '1d' },
      });
    } finally {
      await close();
    }
  });

  it('list_panes maps ActionResult failure to MCP isError', async () => {
    vi.mocked(bridge.executeAction).mockResolvedValueOnce({ success: false, error: 'Chart not ready' });
    const { callTool, close } = await createTestClient();
    try {
      const result = await callTool('romaco_list_panes', {});
      expect(result.isError).toBe(true);
      expect(result.text).toMatch(/Chart not ready/i);
    } finally {
      await close();
    }
  });
});
