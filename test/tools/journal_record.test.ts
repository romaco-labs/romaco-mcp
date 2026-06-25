import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createTestClient } from './_client.js';
import { bridge } from '../../src/bridge.js';
import { chartState } from '../../src/chartState.js';

// The mutating tools call the global `bridge` singleton. Stub it to "succeed"
// without a real browser so we can assert the journal side-effect.
beforeEach(() => {
  vi.spyOn(bridge, 'executeAction').mockResolvedValue({ success: true });
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
      null,
    );
    const { callTool, close } = await createTestClient();
    try {
      await callTool('romaco_clear_drawings', {});
      expect(chartState.snapshot().drawings).toHaveLength(0);
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
});
