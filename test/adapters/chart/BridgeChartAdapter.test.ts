import { describe, expect, it, vi } from 'vitest';
import {
  BridgeChartAdapter,
  ChartActionRejectedError,
} from '../../../src/adapters/outbound/chart/BridgeChartAdapter.js';
import type { BridgeTransport } from '../../../src/adapters/outbound/chart/BridgeChartAdapter.js';
import { createChartId } from '../../../src/domain/chart/model.js';

function transport(overrides: Partial<BridgeTransport> = {}): BridgeTransport {
  return {
    isConnected: true,
    chartId: 'primary',
    getContext: vi.fn(async () => ({ symbol: 'aapl', resolution: '1h' })),
    executeAction: vi.fn(async () => ({ success: true })),
    captureSnapshot: vi.fn(async () => 'data:image/png;base64,x'),
    ...overrides,
  } as BridgeTransport;
}

describe('BridgeChartAdapter', () => {
  it('maps chartId, symbol, and resolution into canonical identity', async () => {
    const adapter = new BridgeChartAdapter(transport());

    await expect(adapter.getIdentity()).resolves.toEqual({
      chartId: 'primary',
      symbol: 'AAPL',
      timeframe: '1h',
    });
  });

  it('throws typed rejection when ActionResult.success is false', async () => {
    const result = {
      success: false,
      error: 'host denied',
      data: { code: 'ACTION_POLICY_DENIED', risk: 'destructive' },
    };
    const adapter = new BridgeChartAdapter(transport({
      executeAction: vi.fn(async () => result),
    }));

    const error = await adapter.execute({ action: 'zoomIn' }).catch((reason) => reason);

    expect(error).toBeInstanceOf(ChartActionRejectedError);
    expect((error as ChartActionRejectedError).result).toEqual(result);
  });

  it('extracts resource ids from successful actions', async () => {
    const adapter = new BridgeChartAdapter(transport({
      executeAction: vi.fn(async () => ({
        success: true,
        data: { indicatorId: 'indicator-1' },
      })),
    }));

    await expect(adapter.execute({
      action: 'addIndicator', indicatorType: 'RSI', params: [14],
    })).resolves.toMatchObject({ resourceIds: ['indicator-1'] });
  });

  it('sends one atomic replacement action after identity validation', async () => {
    const fake = transport();
    const adapter = new BridgeChartAdapter(fake);

    await adapter.replaceDrawingGroup({
      groupId: 'romaco-mcp/thesis',
      idempotencyKey: 'analysis_1:primary',
      expectedIdentity: { chartId: createChartId('primary'), symbol: 'AAPL', timeframe: '1h' },
      drawings: [{
        action: 'addDrawing',
        drawingType: 'horizontalLine',
        points: [{ timestamp: 1_000, price: 100 }],
        groupId: 'ignored-by-adapter',
      }],
    });

    expect(fake.executeAction).toHaveBeenCalledOnce();
    expect(fake.executeAction).toHaveBeenCalledWith({
      action: 'replaceAgentDrawingGroup',
      groupId: 'romaco-mcp/thesis',
      idempotencyKey: 'analysis_1:primary',
      drawings: [{
        drawingType: 'horizontalLine',
        points: [{ timestamp: 1_000, price: 100 }],
        label: undefined,
        style: undefined,
        paneId: undefined,
      }],
    });
  });

  it('fails closed before mutation when chart identity differs', async () => {
    const fake = transport();
    const adapter = new BridgeChartAdapter(fake);

    await expect(adapter.execute(
      { action: 'addIndicator', indicatorType: 'RSI' },
      { expectedIdentity: { chartId: createChartId('primary'), symbol: 'MSFT', timeframe: '1h' } },
    )).rejects.toThrow(/symbol mismatch/i);
    expect(fake.executeAction).not.toHaveBeenCalled();
  });

  it('rejects malformed visible candle arrays at the adapter boundary', async () => {
    const adapter = new BridgeChartAdapter(transport({
      getContext: vi.fn(async () => ({
        symbol: 'AAPL',
        resolution: '1h',
        visibleCandles: [{
          timestamp: 1_000,
          open: 100,
          high: 101,
          low: 99,
          close: 100,
          volume: Number.NaN,
        }],
      })),
    }));

    await expect(adapter.getContext({ includeCandles: true })).rejects.toThrow(/chart candle/i);
  });
});
