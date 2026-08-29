import { describe, expect, it, vi } from 'vitest';
import type { ChartPort } from '../../src/application/ports/chart.js';
import type {
  ChartDesiredStatePort,
  ChartDesiredStateSnapshot,
} from '../../src/application/ports/chartDesiredState.js';
import { ReconcileChartStateUseCase } from '../../src/application/use-cases/reconcileChartState.js';
import type { ChartIdentity, ReplaceDrawingGroupCommand } from '../../src/domain/chart/model.js';
import { createChartId } from '../../src/domain/chart/model.js';

const AAPL: ChartIdentity = {
  chartId: createChartId('chart-a'), symbol: 'AAPL', timeframe: '1d',
};
const TSLA: ChartIdentity = {
  chartId: createChartId('chart-b'), symbol: 'TSLA', timeframe: '1d',
};
const RSI = { action: 'addIndicator', indicatorType: 'RSI', params: [14] } as const;
const ALERT = { action: 'addAlert', price: 150, options: { direction: 'above' as const } } as const;
const DRAWING = {
  action: 'addDrawing', drawingType: 'trendline',
  points: [{ timestamp: 1, price: 100 }, { timestamp: 2, price: 110 }],
} as const;
const GROUP: ReplaceDrawingGroupCommand = {
  groupId: 'romaco-mcp/thesis',
  idempotencyKey: 'analysis-1:chart-a:thesis-v1',
  expectedIdentity: AAPL,
  drawings: [DRAWING],
};

function emptySnapshot(): ChartDesiredStateSnapshot {
  return { indicators: [], drawings: [], drawingGroups: [], alerts: [] };
}

function desiredState(snapshot: ChartDesiredStateSnapshot): ChartDesiredStatePort {
  return {
    recordIndicator: vi.fn(),
    recordDrawing: vi.fn(),
    replaceDrawingGroup: vi.fn(),
    recordAlert: vi.fn(),
    removeIndicator: vi.fn(),
    removeAlert: vi.fn(),
    snapshot: vi.fn(() => snapshot),
    bindReplayedResources: vi.fn(),
  };
}

function chart(identity: ChartIdentity): ChartPort {
  return {
    isConnected: vi.fn(() => true),
    getIdentity: vi.fn(async () => identity),
    getContext: vi.fn(async () => ({
      identity,
      totalCandles: 300,
      indicators: [],
      drawings: [],
      alerts: [],
    })),
    execute: vi.fn(async () => ({ success: true, resourceIds: ['resource-2'] })),
    replaceDrawingGroup: vi.fn(async () => ({ success: true, resourceIds: ['drawing-2'] })),
    captureSnapshot: vi.fn(async () => ({ format: 'png', dataUrl: 'data:image/png;base64,x' })),
  };
}

describe('ReconcileChartStateUseCase', () => {
  it('does not inspect chart when desired state is empty', async () => {
    const live = chart(AAPL);
    const result = await new ReconcileChartStateUseCase(live, desiredState(emptySnapshot())).execute();

    expect(result.status).toBe('empty');
    expect(live.getContext).not.toHaveBeenCalled();
  });

  it('blocks every AAPL replay when replacement chart has different exact identity', async () => {
    const state = desiredState({
      indicators: [{ command: RSI, identity: AAPL, resourceIds: ['rsi-1'] }],
      drawings: [{ command: DRAWING, identity: AAPL, resourceIds: ['drawing-1'] }],
      drawingGroups: [{ command: GROUP, identity: AAPL, resourceIds: ['group-1'] }],
      alerts: [{ command: ALERT, identity: AAPL, resourceIds: ['alert-1'] }],
    });
    const live = chart(TSLA);

    const result = await new ReconcileChartStateUseCase(live, state).execute();

    expect(result).toMatchObject({ status: 'reconciled', applied: 0, skippedIdentity: 4 });
    expect(live.execute).not.toHaveBeenCalled();
    expect(live.replaceDrawingGroup).not.toHaveBeenCalled();
    expect(state.bindReplayedResources).not.toHaveBeenCalled();
  });

  it('replays an atomic group as one replacement command with exact identity', async () => {
    const state = desiredState({
      ...emptySnapshot(),
      drawingGroups: [{ command: GROUP, identity: AAPL, resourceIds: ['old-drawing'] }],
    });
    const live = chart(AAPL);

    const result = await new ReconcileChartStateUseCase(live, state).execute();

    expect(result).toMatchObject({ status: 'reconciled', applied: 1, failures: [] });
    expect(live.replaceDrawingGroup).toHaveBeenCalledOnce();
    expect(live.replaceDrawingGroup).toHaveBeenCalledWith({ ...GROUP, expectedIdentity: AAPL });
    expect(live.execute).not.toHaveBeenCalled();
    expect(state.bindReplayedResources).toHaveBeenCalledWith(
      { ...GROUP, expectedIdentity: AAPL }, AAPL, ['drawing-2'],
    );
  });

  it('never replays removed indicator or alert because absent desired entries stay absent', async () => {
    const state = desiredState(emptySnapshot());
    const live = chart(AAPL);

    await new ReconcileChartStateUseCase(live, state).execute();

    expect(live.execute).not.toHaveBeenCalled();
  });

  it('diffs present overlays and applies only missing commands', async () => {
    const state = desiredState({
      ...emptySnapshot(),
      indicators: [{ command: RSI, identity: AAPL, resourceIds: ['rsi-1'] }],
      alerts: [{ command: ALERT, identity: AAPL, resourceIds: ['alert-1'] }],
    });
    const live = chart(AAPL);
    vi.mocked(live.getContext).mockResolvedValue({
      identity: AAPL,
      totalCandles: 300,
      indicators: [{ id: 'rsi-live', type: 'RSI', params: [14] }],
      drawings: [],
      alerts: [],
    });

    const result = await new ReconcileChartStateUseCase(live, state).execute();

    expect(result.applied).toBe(1);
    expect(live.execute).toHaveBeenCalledOnce();
    expect(live.execute).toHaveBeenCalledWith(ALERT, { expectedIdentity: AAPL });
  });

  it('keeps desired state after failed apply and continues remaining commands', async () => {
    const state = desiredState({
      ...emptySnapshot(),
      indicators: [{ command: RSI, identity: AAPL, resourceIds: ['rsi-1'] }],
      alerts: [{ command: ALERT, identity: AAPL, resourceIds: ['alert-1'] }],
    });
    const live = chart(AAPL);
    vi.mocked(live.execute)
      .mockRejectedValueOnce(new Error('host denied'))
      .mockResolvedValueOnce({ success: true, resourceIds: ['alert-2'] });

    const result = await new ReconcileChartStateUseCase(live, state).execute();

    expect(result).toMatchObject({ applied: 1, failures: [{ action: 'addIndicator', message: 'host denied' }] });
    expect(state.snapshot).toHaveBeenCalledOnce();
  });

  it('retries unready chart and cancels older reconciliation generation', async () => {
    const state = desiredState({
      ...emptySnapshot(),
      indicators: [{ command: RSI, identity: AAPL, resourceIds: [] }],
    });
    const live = chart(AAPL);
    vi.mocked(live.getContext)
      .mockResolvedValueOnce({ identity: AAPL, totalCandles: 0 })
      .mockResolvedValue({ identity: AAPL, totalCandles: 300, indicators: [], drawings: [], alerts: [] });
    let releaseDelay: (() => void) | undefined;
    const delay = vi.fn(() => new Promise<void>((resolve) => { releaseDelay = resolve; }));
    const useCase = new ReconcileChartStateUseCase(live, state, delay);

    const older = useCase.execute({ attempts: 2, delayMs: 1 });
    await vi.waitFor(() => expect(delay).toHaveBeenCalledOnce());
    const newer = useCase.execute({ attempts: 1, delayMs: 0 });
    releaseDelay?.();

    await expect(older).resolves.toMatchObject({ status: 'superseded' });
    await expect(newer).resolves.toMatchObject({ status: 'reconciled', applied: 1 });
    expect(live.execute).toHaveBeenCalledOnce();
  });
});
