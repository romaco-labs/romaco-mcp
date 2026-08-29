import { describe, expect, it, vi } from 'vitest';
import type { ChartPort } from '../../src/application/ports/chart.js';
import type {
  ChartDesiredStatePort,
  ChartDesiredStateSnapshot,
} from '../../src/application/ports/chartDesiredState.js';
import { ReconcileChartStateUseCase } from '../../src/application/use-cases/reconcileChartState.js';
import type { ChartIdentity, ReplaceDrawingGroupCommand } from '../../src/domain/chart/model.js';
import { createChartId } from '../../src/domain/chart/model.js';
import { LegacyChartJournal } from '../../src/bootstrap/LegacyChartJournal.js';
import { ChartStateJournal } from '../../src/chartState.js';

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
    structuralRevision: vi.fn(() => 0),
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
    expect(state.bindReplayedResources).toHaveBeenCalledWith(RSI, AAPL, ['rsi-live']);
  });

  it('refreshes matching indicator and alert host IDs without replay writes', async () => {
    const state = desiredState({
      ...emptySnapshot(),
      indicators: [{ command: RSI, identity: AAPL, resourceIds: ['stale-rsi'] }],
      alerts: [{ command: ALERT, identity: AAPL, resourceIds: ['stale-alert'] }],
    });
    const live = chart(AAPL);
    vi.mocked(live.getContext).mockResolvedValue({
      identity: AAPL,
      totalCandles: 300,
      indicators: [{ id: 'live-rsi', type: 'RSI', params: [14] }],
      drawings: [],
      alerts: [{ id: 'live-alert', price: 150, direction: 'above' }],
    });

    const result = await new ReconcileChartStateUseCase(live, state).execute();

    expect(result).toMatchObject({ applied: 0, failures: [] });
    expect(live.execute).not.toHaveBeenCalled();
    expect(state.bindReplayedResources).toHaveBeenCalledWith(RSI, AAPL, ['live-rsi']);
    expect(state.bindReplayedResources).toHaveBeenCalledWith(ALERT, AAPL, ['live-alert']);
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
    expect(state.snapshot).toHaveBeenCalledTimes(2);
  });

  it('treats success=false as failure and never binds rejected resources', async () => {
    const state = desiredState({
      ...emptySnapshot(),
      indicators: [{ command: RSI, identity: AAPL, resourceIds: [] }],
    });
    const live = chart(AAPL);
    vi.mocked(live.execute).mockResolvedValue({ success: false, error: 'policy denied' });

    const result = await new ReconcileChartStateUseCase(live, state).execute();

    expect(result).toMatchObject({
      applied: 0,
      failures: [{ action: 'addIndicator', message: 'policy denied' }],
    });
    expect(state.bindReplayedResources).not.toHaveBeenCalled();
  });

  it('recaptures desired state after readiness wait so a removed entry stays removed', async () => {
    const initial = {
      ...emptySnapshot(),
      indicators: [{ command: RSI, identity: AAPL, resourceIds: ['rsi-1'] }],
    };
    const state = desiredState(initial);
    vi.mocked(state.snapshot)
      .mockReturnValueOnce(initial)
      .mockReturnValueOnce(emptySnapshot());
    const live = chart(AAPL);
    vi.mocked(live.getContext)
      .mockResolvedValueOnce({ identity: AAPL, totalCandles: 0 })
      .mockResolvedValueOnce({ identity: AAPL, totalCandles: 300 });

    await new ReconcileChartStateUseCase(live, state, async () => undefined)
      .execute({ attempts: 2, delayMs: 0 });

    expect(state.snapshot).toHaveBeenCalledTimes(2);
    expect(live.execute).not.toHaveBeenCalled();
  });

  it('stops and never binds when a newer ready supersedes an in-flight apply', async () => {
    const initial = {
      ...emptySnapshot(),
      indicators: [{ command: RSI, identity: AAPL, resourceIds: [] }],
      alerts: [{ command: ALERT, identity: AAPL, resourceIds: [] }],
    };
    const state = desiredState(initial);
    vi.mocked(state.snapshot)
      .mockReturnValueOnce(initial)
      .mockReturnValueOnce(initial)
      .mockReturnValueOnce(emptySnapshot());
    const live = chart(AAPL);
    let finishApply: ((result: { success: true; resourceIds: string[] }) => void) | undefined;
    vi.mocked(live.execute).mockImplementationOnce(() => new Promise((resolve) => {
      finishApply = resolve;
    }));
    const useCase = new ReconcileChartStateUseCase(live, state);

    const older = useCase.execute();
    await vi.waitFor(() => expect(live.execute).toHaveBeenCalledOnce());
    await expect(useCase.execute()).resolves.toMatchObject({ status: 'empty' });
    finishApply?.({ success: true, resourceIds: ['late-rsi'] });

    await expect(older).resolves.toMatchObject({ status: 'superseded', applied: 0 });
    expect(live.execute).toHaveBeenCalledOnce();
    expect(state.bindReplayedResources).not.toHaveBeenCalled();
  });

  it('stops and never binds when desired structure changes during a replay write', async () => {
    const initial = {
      ...emptySnapshot(),
      indicators: [{ command: RSI, identity: AAPL, resourceIds: [] }],
    };
    let revision = 1;
    const state = desiredState(initial);
    vi.mocked(state.structuralRevision).mockImplementation(() => revision);
    const live = chart(AAPL);
    let finishApply: ((result: { success: true; resourceIds: string[] }) => void) | undefined;
    vi.mocked(live.execute).mockImplementationOnce(() => new Promise((resolve) => {
      finishApply = resolve;
    }));

    const pending = new ReconcileChartStateUseCase(live, state).execute();
    await vi.waitFor(() => expect(live.execute).toHaveBeenCalledOnce());
    revision += 1; // concurrent desired-state removal
    finishApply?.({ success: true, resourceIds: ['late-rsi'] });

    await expect(pending).resolves.toMatchObject({ status: 'superseded', applied: 0 });
    expect(state.bindReplayedResources).not.toHaveBeenCalled();
  });

  it('keeps concurrent exact removal absent when replay write completes late', async () => {
    const journal = new LegacyChartJournal(new ChartStateJournal());
    journal.recordIndicator({ type: 'RSI', params: [14] }, AAPL);
    const live = chart(AAPL);
    let finishApply: ((result: { success: true; resourceIds: string[] }) => void) | undefined;
    vi.mocked(live.execute).mockImplementationOnce(() => new Promise((resolve) => {
      finishApply = resolve;
    }));

    const pending = new ReconcileChartStateUseCase(live, journal).execute();
    await vi.waitFor(() => expect(live.execute).toHaveBeenCalledOnce());
    journal.removeIndicator(AAPL, 'not-bound-yet', 'RSI', [14]);
    finishApply?.({ success: true, resourceIds: ['late-rsi'] });

    await expect(pending).resolves.toMatchObject({ status: 'superseded', applied: 0 });
    expect(journal.snapshot().indicators).toEqual([]);
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
