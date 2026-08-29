import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { bridge } from '../../src/bridge.js';
import { chartState } from '../../src/chartState.js';
import { createTestClient } from './_client.js';

type Harness = Awaited<ReturnType<typeof createTestClient>>;

describe('chart removal tools resolve user-facing selectors to chart ids', () => {
  let h: Harness;

  beforeEach(async () => {
    chartState.clear();
    h = await createTestClient();
  });

  afterEach(async () => {
    await h.close();
    vi.restoreAllMocks();
    chartState.clear();
  });

  it('removes an indicator by resolving its type to indicatorId', async () => {
    vi.spyOn(bridge, 'getContext').mockResolvedValue({
      existingIndicators: [{ id: 'indicator-rsi-14', name: 'RSI' }],
    });
    const execute = vi.spyOn(bridge, 'executeAction').mockResolvedValue({ success: true });

    const result = await h.callTool('romaco_remove_indicator', { indicatorType: 'rsi' });

    expect(result.isError).toBe(false);
    expect(execute).toHaveBeenCalledWith({
      action: 'removeIndicator',
      indicatorId: 'indicator-rsi-14',
    });
  });

  it('does not send a malformed removeIndicator action when type is absent', async () => {
    vi.spyOn(bridge, 'getContext').mockResolvedValue({ existingIndicators: [] });
    const execute = vi.spyOn(bridge, 'executeAction');

    const result = await h.callTool('romaco_remove_indicator', { indicatorType: 'RSI' });

    expect(result.isError).toBe(true);
    expect(result.text).toMatch(/not found/i);
    expect(execute).not.toHaveBeenCalled();
  });

  it('removes an alert by resolving price and direction to alertId', async () => {
    vi.spyOn(bridge, 'getContext').mockResolvedValue({
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
    });
  });

  it('does not send a malformed removeAlert action when no alert matches', async () => {
    vi.spyOn(bridge, 'getContext').mockResolvedValue({ alerts: [] });
    const execute = vi.spyOn(bridge, 'executeAction');

    const result = await h.callTool('romaco_remove_alert', { price: 200 });

    expect(result.isError).toBe(true);
    expect(result.text).toMatch(/not found/i);
    expect(execute).not.toHaveBeenCalled();
  });
});
