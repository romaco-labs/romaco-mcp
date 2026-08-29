import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { bridge } from '../../src/bridge.js';
import { chartState } from '../../src/chartState.js';
import { createTestClient } from './_client.js';
import type { BridgeAction } from '../../src/types.js';
import { createChartId } from '../../src/domain/chart/model.js';

const AAPL_DAILY = {
  chartId: createChartId('primary'), symbol: 'AAPL', timeframe: '1d' as const,
};

type Harness = Awaited<ReturnType<typeof createTestClient>>;

describe('chart removal tools resolve user-facing selectors to chart ids', () => {
  let h: Harness;

  beforeEach(async () => {
    chartState.clear();
    vi.spyOn(bridge, 'chartId', 'get').mockReturnValue('primary');
    h = await createTestClient();
  });

  afterEach(async () => {
    await h.close();
    vi.restoreAllMocks();
    chartState.clear();
  });

  it('removes an indicator by resolving its type to indicatorId', async () => {
    vi.spyOn(bridge, 'getContext').mockResolvedValue({
      symbol: 'AAPL', resolution: '1d',
      existingIndicators: [{ id: 'indicator-rsi-14', name: 'RSI' }],
    });
    const execute = vi.spyOn(bridge, 'executeAction').mockResolvedValue({ success: true });

    const result = await h.callTool('romaco_remove_indicator', { indicatorType: 'rsi' });

    expect(result.isError).toBe(false);
    expect(execute).toHaveBeenCalledWith({
      action: 'removeIndicator',
      indicatorId: 'indicator-rsi-14',
      expectedIdentity: { chartId: 'primary', symbol: 'AAPL', resolution: '1d' },
    });
  });

  it('does not send a malformed removeIndicator action when type is absent', async () => {
    vi.spyOn(bridge, 'getContext').mockResolvedValue({
      symbol: 'AAPL', resolution: '1d', existingIndicators: [],
    });
    const execute = vi.spyOn(bridge, 'executeAction');

    const result = await h.callTool('romaco_remove_indicator', { indicatorType: 'RSI' });

    expect(result.isError).toBe(true);
    expect(result.text).toMatch(/not found/i);
    expect(execute).not.toHaveBeenCalled();
  });

  it('removes an alert by resolving price and direction to alertId', async () => {
    vi.spyOn(bridge, 'getContext').mockResolvedValue({
      symbol: 'AAPL', resolution: '1d',
      alerts: [
        { id: 'alert-above-200', price: 200, direction: 'above' },
        { id: 'alert-below-200', price: 200, direction: 'below' },
      ],
    });
    const execute = vi.spyOn(bridge, 'executeAction').mockResolvedValue({ success: true });

    const result = await h.callTool('romaco_remove_alert', { price: 200, direction: 'below' });

    expect(result.isError).toBe(false);
    expect(execute).toHaveBeenCalledWith({
      action: 'removeAlert',
      alertId: 'alert-below-200',
      expectedIdentity: { chartId: 'primary', symbol: 'AAPL', resolution: '1d' },
    });
  });

  it('does not send a malformed removeAlert action when no alert matches', async () => {
    vi.spyOn(bridge, 'getContext').mockResolvedValue({
      symbol: 'AAPL', resolution: '1d', alerts: [],
    });
    const execute = vi.spyOn(bridge, 'executeAction');

    const result = await h.callTool('romaco_remove_alert', { price: 200 });

    expect(result.isError).toBe(true);
    expect(result.text).toMatch(/not found/i);
    expect(execute).not.toHaveBeenCalled();
  });

  it('removes only the exact journaled indicator resource', async () => {
    chartState.recordIndicator(
      { action: 'addIndicator', indicatorType: 'RSI', params: [14] }, 'AAPL', 'rsi-14',
    );
    chartState.recordIndicator(
      { action: 'addIndicator', indicatorType: 'RSI', params: [50] }, 'AAPL', 'rsi-50',
    );
    vi.spyOn(bridge, 'getContext').mockResolvedValue({
      symbol: 'AAPL', resolution: '1d',
      existingIndicators: [{ id: 'rsi-50', name: 'RSI', params: [50] }],
    });
    vi.spyOn(bridge, 'executeAction').mockResolvedValue({ success: true });

    const result = await h.callTool('romaco_remove_indicator', { indicatorType: 'RSI' });

    expect(result.isError).toBe(false);
    expect(chartState.snapshot().indicators.map((entry) => entry.resourceId)).toEqual(['rsi-14']);
  });

  it('removes alert by resourceId and nested options.direction without resurrection', async () => {
    chartState.recordAlert(
      { action: 'addAlert', price: 200, options: { direction: 'above' } }, AAPL_DAILY, 'alert-above',
    );
    chartState.recordAlert(
      { action: 'addAlert', price: 200, options: { direction: 'below' } }, AAPL_DAILY, 'alert-below',
    );
    vi.spyOn(bridge, 'getContext').mockResolvedValue({
      symbol: 'AAPL', resolution: '1d',
      alerts: [{ id: 'alert-below', price: 200, direction: 'below' }],
    });
    vi.spyOn(bridge, 'executeAction').mockResolvedValue({ success: true });

    const result = await h.callTool('romaco_remove_alert', { price: 200, direction: 'below' });

    expect(result.isError).toBe(false);
    const remaining = chartState.snapshot().alerts;
    expect(remaining).toHaveLength(1);
    expect(remaining[0].resourceId).toBe('alert-above');
    expect(
      (remaining[0].action as Extract<BridgeAction, { action: 'addAlert' }>).options?.direction,
    ).toBe('above');
  });
});
