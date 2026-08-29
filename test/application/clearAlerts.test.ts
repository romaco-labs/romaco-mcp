import { describe, expect, it, vi } from 'vitest';
import { ClearAlertsUseCase } from '../../src/application/use-cases/clearAlerts.js';
import type { ChartPort } from '../../src/application/ports/chart.js';
import { createChartId, type ChartAlertState } from '../../src/domain/chart/model.js';

const identity = {
  chartId: createChartId('chart-aapl'), symbol: 'AAPL', timeframe: '1d' as const,
};

function fixture(initialAlerts: ChartAlertState[] = [
  { id: 'alert-b', price: 160, direction: 'above' },
  { id: 'alert-a', price: 140, direction: 'below' },
]) {
  let alerts = structuredClone(initialAlerts);
  const execute = vi.fn(async (command: { action: string; alertId?: string }) => {
    if (command.action === 'removeAlert') {
      alerts = alerts.filter((alert) => alert.id !== command.alertId);
    }
    return { success: true };
  });
  const chart: ChartPort = {
    isConnected: () => true,
    getIdentity: vi.fn(async () => identity),
    getContext: vi.fn(async () => ({ identity, totalCandles: 300, alerts: structuredClone(alerts) })),
    execute,
    replaceDrawingGroup: vi.fn(),
    captureSnapshot: vi.fn(),
  };
  const removeAlert = vi.fn((alertId: string) => {
    alerts = alerts.filter((alert) => alert.id !== alertId);
  });
  return {
    chart,
    execute,
    removeAlert,
    setAlerts(next: ChartAlertState[]) { alerts = structuredClone(next); },
    useCase: new ClearAlertsUseCase(chart, { removeAlert }),
  };
}

describe('ClearAlertsUseCase', () => {
  it('previews exact sorted alert scope with zero chart writes', async () => {
    const context = fixture();
    const plan = await context.useCase.preview();

    expect(plan.identity).toEqual(identity);
    expect(plan.alerts).toEqual([
      { alertId: 'alert-a', price: 140, direction: 'below' },
      { alertId: 'alert-b', price: 160, direction: 'above' },
    ]);
    expect(plan.fingerprint).toContain('clear-alerts-v1');
    expect(context.execute).not.toHaveBeenCalled();
  });

  it('fails closed when any observed alert lacks a stable ID', async () => {
    const context = fixture([{ price: 140, direction: 'below' }]);

    await expect(context.useCase.preview()).rejects.toMatchObject({ code: 'CHART_NOT_READY' });
    expect(context.execute).not.toHaveBeenCalled();
  });

  it('rejects a stale approved plan before every chart write', async () => {
    const context = fixture();
    const plan = await context.useCase.preview();
    context.setAlerts([{ id: 'alert-new', price: 170, direction: 'cross' }]);

    await expect(context.useCase.apply(plan)).rejects.toMatchObject({ code: 'CHART_CONTEXT_MISMATCH' });
    expect(context.execute).not.toHaveBeenCalled();
    expect(context.removeAlert).not.toHaveBeenCalled();
  });

  it('removes alerts individually with exact identity and journals each success', async () => {
    const context = fixture();
    const plan = await context.useCase.preview();
    const result = await context.useCase.apply(plan);

    expect(result.removedAlertIds).toEqual(['alert-a', 'alert-b']);
    expect(context.execute).toHaveBeenCalledTimes(2);
    expect(context.execute).toHaveBeenNthCalledWith(
      1,
      { action: 'removeAlert', alertId: 'alert-a' },
      { expectedIdentity: identity },
    );
    expect(context.execute).toHaveBeenNthCalledWith(
      2,
      { action: 'removeAlert', alertId: 'alert-b' },
      { expectedIdentity: identity },
    );
    expect(context.execute.mock.calls.every(([command]) => command.action !== 'clearAlerts')).toBe(true);
    expect(context.removeAlert).toHaveBeenCalledTimes(2);
  });

  it('reports partial apply and journals only successful alert removals', async () => {
    const context = fixture();
    context.execute
      .mockResolvedValueOnce({ success: true })
      .mockRejectedValueOnce(new Error('host denied'));
    const plan = await context.useCase.preview();

    await expect(context.useCase.apply(plan)).rejects.toMatchObject({
      code: 'PARTIAL_APPLY',
      details: { appliedAlertIds: ['alert-a'], failedAlertId: 'alert-b' },
    });
    expect(context.removeAlert).toHaveBeenCalledOnce();
    expect(context.removeAlert).toHaveBeenCalledWith('alert-a', 140, 'below');
  });
});
