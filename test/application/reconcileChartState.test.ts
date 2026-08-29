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

let nextTestEntryId = 0;
function addEntryMetadata(snapshot: ChartDesiredStateSnapshot): ChartDesiredStateSnapshot {
  for (const entries of [
    snapshot.indicators,
    snapshot.drawings,
    snapshot.drawingGroups,
    snapshot.alerts,
  ]) {
    for (const entry of entries) {
      const mutable = entry as typeof entry & { entryId?: string; entryVersion?: number };
      mutable.entryId ??= `test-entry-${++nextTestEntryId}`;
      mutable.entryVersion ??= 1;
    }
  }
  return snapshot;
}

function desiredState(snapshot: ChartDesiredStateSnapshot): ChartDesiredStatePort {
  addEntryMetadata(snapshot);
  return {
    recordIndicator: vi.fn(),
    recordDrawing: vi.fn(),
    replaceDrawingGroup: vi.fn(),
    recordAlert: vi.fn(),
    removeIndicator: vi.fn(),
    removeAlert: vi.fn(),
    structuralRevision: vi.fn(() => 0),
    snapshot: vi.fn(() => snapshot),
    bindReplayedResources: vi.fn(() => true),
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

  it('treats incomplete live identity as not ready before any replay or debt cleanup', async () => {
    const state = desiredState({
      ...emptySnapshot(),
      indicators: [{ command: RSI, identity: AAPL, resourceIds: ['old-rsi'] }],
    });
    const live = chart(AAPL);
    vi.mocked(live.getContext).mockResolvedValue({
      identity: { chartId: createChartId('chart-a') },
      totalCandles: 300,
      indicators: [], drawings: [], alerts: [],
    });

    await expect(new ReconcileChartStateUseCase(live, state).execute()).resolves.toMatchObject({
      status: 'not-ready',
      notReadyReason: expect.stringMatching(/identity is incomplete/i),
    });
    expect(live.execute).not.toHaveBeenCalled();
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
      expect.any(String), 1, ['drawing-2'],
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
      indicators: [{ id: 'rsi-1', type: 'RSI', params: [14] }],
      drawings: [],
      alerts: [],
    });

    const result = await new ReconcileChartStateUseCase(live, state).execute();

    expect(result.applied).toBe(1);
    expect(live.execute).toHaveBeenCalledOnce();
    expect(live.execute).toHaveBeenCalledWith(ALERT, { expectedIdentity: AAPL });
    expect(state.bindReplayedResources).toHaveBeenCalledWith(expect.any(String), 1, ['rsi-1']);
  });

  it('recognizes only exact owned indicator and alert ids without replay writes', async () => {
    const state = desiredState({
      ...emptySnapshot(),
      indicators: [{ command: RSI, identity: AAPL, resourceIds: ['stale-rsi'] }],
      alerts: [{ command: ALERT, identity: AAPL, resourceIds: ['stale-alert'] }],
    });
    const live = chart(AAPL);
    vi.mocked(live.getContext).mockResolvedValue({
      identity: AAPL,
      totalCandles: 300,
      indicators: [{ id: 'stale-rsi', type: 'RSI', params: [14] }],
      drawings: [],
      alerts: [{ id: 'stale-alert', price: 150, direction: 'above' }],
    });

    const result = await new ReconcileChartStateUseCase(live, state).execute();

    expect(result).toMatchObject({ applied: 0, failures: [] });
    expect(live.execute).not.toHaveBeenCalled();
    expect(state.bindReplayedResources).toHaveBeenCalledWith(expect.any(String), 1, ['stale-rsi']);
    expect(state.bindReplayedResources).toHaveBeenCalledWith(expect.any(String), 1, ['stale-alert']);
  });

  it('never claims user-owned RSI or alert ids that only match semantically', async () => {
    const state = desiredState({
      ...emptySnapshot(),
      indicators: [{ command: RSI, identity: AAPL, resourceIds: ['our-old-rsi'] }],
      alerts: [{ command: ALERT, identity: AAPL, resourceIds: ['our-old-alert'] }],
    });
    const live = chart(AAPL);
    vi.mocked(live.getContext).mockResolvedValue({
      identity: AAPL,
      totalCandles: 300,
      indicators: [{ id: 'user-rsi', type: 'RSI', params: [14] }],
      drawings: [],
      alerts: [{ id: 'user-alert', price: 150, direction: 'above' }],
    });
    vi.mocked(live.execute)
      .mockResolvedValueOnce({ success: true, resourceIds: ['our-new-rsi'] })
      .mockResolvedValueOnce({ success: true, resourceIds: ['our-new-alert'] });

    const result = await new ReconcileChartStateUseCase(live, state).execute();

    expect(result).toMatchObject({ status: 'reconciled', applied: 2, failures: [] });
    expect(state.bindReplayedResources).toHaveBeenCalledWith(expect.any(String), 1, ['our-new-rsi']);
    expect(state.bindReplayedResources).toHaveBeenCalledWith(expect.any(String), 1, ['our-new-alert']);
    expect(state.bindReplayedResources).not.toHaveBeenCalledWith(expect.anything(), expect.anything(), ['user-rsi']);
    expect(state.bindReplayedResources).not.toHaveBeenCalledWith(expect.anything(), expect.anything(), ['user-alert']);
    expect(vi.mocked(live.execute).mock.calls.some(([command]) => (
      command.action === 'removeIndicator' || command.action === 'removeAlert'
    ))).toBe(false);
  });

  it('marks no-id individual desired state indeterminate instead of semantic replay', async () => {
    const state = desiredState({
      ...emptySnapshot(),
      indicators: [{ command: RSI, identity: AAPL, resourceIds: [] }],
    });
    const live = chart(AAPL);
    vi.mocked(live.getContext).mockResolvedValue({
      identity: AAPL,
      totalCandles: 300,
      indicators: [{ id: 'user-rsi', type: 'RSI', params: [14] }],
      drawings: [],
      alerts: [],
    });

    await expect(new ReconcileChartStateUseCase(live, state).execute()).resolves.toMatchObject({
      status: 'indeterminate',
      failures: [{ message: expect.stringMatching(/no stable host id/i) }],
    });
    expect(live.execute).not.toHaveBeenCalled();
    expect(state.bindReplayedResources).not.toHaveBeenCalled();
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
      indicators: [{ command: RSI, identity: AAPL, resourceIds: ['old-rsi'] }],
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

  it('serializes a newer ready and safely binds a completed current replay', async () => {
    const initial = {
      ...emptySnapshot(),
      indicators: [{ command: RSI, identity: AAPL, resourceIds: ['old-rsi'] }],
      alerts: [{ command: ALERT, identity: AAPL, resourceIds: ['old-alert'] }],
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
    const newer = useCase.execute();
    finishApply?.({ success: true, resourceIds: ['late-rsi'] });

    await expect(older).resolves.toMatchObject({ status: 'superseded', applied: 0 });
    await expect(newer).resolves.toMatchObject({ status: 'empty' });
    expect(live.execute).toHaveBeenCalledOnce();
    expect(state.bindReplayedResources).toHaveBeenCalledWith(expect.any(String), 1, ['late-rsi']);
  });

  it('stops and never binds when desired structure changes during a replay write', async () => {
    const initial = {
      ...emptySnapshot(),
      indicators: [{ command: RSI, identity: AAPL, resourceIds: ['old-rsi'] }],
    };
    let revision = 1;
    let removed = false;
    const state = desiredState(initial);
    vi.mocked(state.structuralRevision).mockImplementation(() => revision);
    vi.mocked(state.snapshot).mockImplementation(() => removed ? emptySnapshot() : initial);
    const live = chart(AAPL);
    let finishApply: ((result: { success: true; resourceIds: string[] }) => void) | undefined;
    vi.mocked(live.execute).mockImplementationOnce(() => new Promise((resolve) => {
      finishApply = resolve;
    }));

    const pending = new ReconcileChartStateUseCase(live, state).execute();
    await vi.waitFor(() => expect(live.execute).toHaveBeenCalledOnce());
    removed = true;
    revision += 1; // concurrent desired-state removal
    finishApply?.({ success: true, resourceIds: ['late-rsi'] });

    await expect(pending).resolves.toMatchObject({ status: 'superseded', applied: 0 });
    expect(state.bindReplayedResources).not.toHaveBeenCalled();
    expect(live.execute).toHaveBeenNthCalledWith(
      2,
      { action: 'removeIndicator', indicatorId: 'late-rsi' },
      { expectedIdentity: AAPL },
    );
  });

  it('keeps concurrent exact removal absent when replay write completes late', async () => {
    const journal = new LegacyChartJournal(new ChartStateJournal());
    journal.recordIndicator({ type: 'RSI', params: [14] }, AAPL, 'old-rsi');
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
    expect(live.execute).toHaveBeenNthCalledWith(
      2,
      { action: 'removeIndicator', indicatorId: 'late-rsi' },
      { expectedIdentity: AAPL },
    );
  });

  it('compensates a completed late indicator replay so the host has no removed ghost', async () => {
    const state = new ChartStateJournal();
    const journal = new LegacyChartJournal(state);
    journal.recordIndicator({ type: 'RSI', params: [14] }, AAPL, 'old-rsi');
    const hostIndicators = new Map<string, { type: string; params: number[] }>();
    let releaseAdd!: () => void;
    const addGate = new Promise<void>((resolve) => { releaseAdd = resolve; });
    const live = chart(AAPL);
    vi.mocked(live.getContext).mockImplementation(async () => ({
      identity: AAPL,
      totalCandles: 300,
      indicators: [...hostIndicators].map(([id, indicator]) => ({ id, ...indicator })),
      drawings: [],
      alerts: [],
    }));
    vi.mocked(live.execute).mockImplementation(async (command) => {
      if (command.action === 'addIndicator') {
        await addGate;
        hostIndicators.set('late-rsi', { type: command.indicatorType, params: command.params ?? [] });
        return { success: true, resourceIds: ['late-rsi'] };
      }
      if (command.action === 'removeIndicator') {
        hostIndicators.delete(command.indicatorId);
        return { success: true };
      }
      return { success: true };
    });

    const pending = new ReconcileChartStateUseCase(live, journal).execute();
    await vi.waitFor(() => expect(live.execute).toHaveBeenCalledOnce());
    journal.removeIndicator(AAPL, 'not-bound-yet', 'RSI', [14]);
    releaseAdd();

    await expect(pending).resolves.toMatchObject({ status: 'superseded', failures: [] });
    expect(hostIndicators.size).toBe(0);
    expect(journal.snapshot().indicators).toEqual([]);
  });

  it('restores the latest atomic group payload after an older replay completes late', async () => {
    const state = new ChartStateJournal();
    const journal = new LegacyChartJournal(state);
    const latestDrawing = {
      ...DRAWING,
      points: [{ timestamp: 3, price: 120 }, { timestamp: 4, price: 130 }],
    } as const;
    journal.replaceDrawingGroup(GROUP.groupId, GROUP.drawings, AAPL, GROUP.idempotencyKey);
    let hostDrawings: ReplaceDrawingGroupCommand['drawings'] = [];
    let releaseOld!: () => void;
    const oldGate = new Promise<void>((resolve) => { releaseOld = resolve; });
    const live = chart(AAPL);
    let replacementCount = 0;
    let hostRevision = 0;
    const ledger = new Map<string, { drawings: ReplaceDrawingGroupCommand['drawings']; resourceIds: string[] }>();
    vi.mocked(live.replaceDrawingGroup).mockImplementation(async (command) => {
      replacementCount += 1;
      const cached = ledger.get(command.idempotencyKey);
      if (cached) return { success: true, resourceIds: cached.resourceIds };
      if (replacementCount === 1) await oldGate;
      hostRevision += 1;
      const resourceIds = command.drawings.map((_, index) => `drawing-${hostRevision}-${index}`);
      hostDrawings = command.drawings;
      ledger.set(command.idempotencyKey, { drawings: command.drawings, resourceIds });
      return { success: true, resourceIds };
    });

    const pending = new ReconcileChartStateUseCase(live, journal).execute();
    await vi.waitFor(() => expect(live.replaceDrawingGroup).toHaveBeenCalledOnce());
    journal.replaceDrawingGroup(GROUP.groupId, [latestDrawing], AAPL, 'analysis-2:chart-a:thesis-v1');
    const latest = journal.snapshot().drawingGroups[0];
    // Simulate latest workflow already applied and cached before older Kold lands.
    hostDrawings = latest.command.drawings;
    ledger.set(latest.command.idempotencyKey, {
      drawings: latest.command.drawings,
      resourceIds: ['drawing-new-cached'],
    });
    releaseOld();

    await expect(pending).resolves.toMatchObject({ status: 'superseded', failures: [] });
    expect(hostDrawings).toEqual(latest.command.drawings);
    expect(live.replaceDrawingGroup).toHaveBeenCalledTimes(2);
    const compensation = vi.mocked(live.replaceDrawingGroup).mock.calls[1][0];
    expect(compensation).toMatchObject({
      groupId: GROUP.groupId,
      drawings: latest.command.drawings,
    });
    expect(compensation.idempotencyKey).not.toBe(latest.command.idempotencyKey);
    expect(compensation.idempotencyKey).not.toBe(GROUP.idempotencyKey);
    expect(journal.snapshot().drawingGroups[0].resourceIds).toEqual(['drawing-2-0']);
  });

  it('atomically clears a removed group after its older replay completes late', async () => {
    const state = new ChartStateJournal();
    const journal = new LegacyChartJournal(state);
    journal.replaceDrawingGroup(GROUP.groupId, GROUP.drawings, AAPL, GROUP.idempotencyKey);
    let hostDrawingCount = 0;
    let releaseOld!: () => void;
    const oldGate = new Promise<void>((resolve) => { releaseOld = resolve; });
    const live = chart(AAPL);
    let replacementCount = 0;
    vi.mocked(live.replaceDrawingGroup).mockImplementation(async (command) => {
      replacementCount += 1;
      if (replacementCount === 1) await oldGate;
      hostDrawingCount = command.drawings.length;
      return { success: true, resourceIds: command.drawings.map((_, index) => `drawing-${replacementCount}-${index}`) };
    });

    const pending = new ReconcileChartStateUseCase(live, journal).execute();
    await vi.waitFor(() => expect(live.replaceDrawingGroup).toHaveBeenCalledOnce());
    state.removeDrawingsByGroupForIdentity(GROUP.groupId, AAPL);
    releaseOld();

    await expect(pending).resolves.toMatchObject({ status: 'superseded', failures: [] });
    expect(hostDrawingCount).toBe(0);
    expect(live.replaceDrawingGroup).toHaveBeenCalledTimes(2);
    expect(vi.mocked(live.replaceDrawingGroup).mock.calls[1][0].drawings).toEqual([]);
  });

  it('reasserts a current atomic group after ambiguous response loss and unrelated revision drift', async () => {
    const state = new ChartStateJournal();
    const journal = new LegacyChartJournal(state);
    journal.replaceDrawingGroup(GROUP.groupId, GROUP.drawings, AAPL, GROUP.idempotencyKey);
    let hostDrawings: ReplaceDrawingGroupCommand['drawings'] = [];
    let releaseOld!: () => void;
    const oldGate = new Promise<void>((resolve) => { releaseOld = resolve; });
    const live = chart(AAPL);
    let replacementCount = 0;
    vi.mocked(live.replaceDrawingGroup).mockImplementation(async (command) => {
      replacementCount += 1;
      if (replacementCount === 1) {
        await oldGate;
        hostDrawings = command.drawings;
        throw new Error('response lost after atomic host apply');
      }
      hostDrawings = command.drawings;
      return { success: true, resourceIds: ['fresh-group-drawing'] };
    });

    const pending = new ReconcileChartStateUseCase(live, journal).execute();
    await vi.waitFor(() => expect(live.replaceDrawingGroup).toHaveBeenCalledOnce());
    journal.recordAlert(ALERT, AAPL, 'unrelated-alert');
    releaseOld();

    await expect(pending).resolves.toMatchObject({ status: 'superseded', failures: [] });
    expect(hostDrawings).toEqual(journal.snapshot().drawingGroups[0].command.drawings);
    expect(live.replaceDrawingGroup).toHaveBeenCalledTimes(2);
    expect(vi.mocked(live.replaceDrawingGroup).mock.calls[1][0].idempotencyKey)
      .not.toBe(GROUP.idempotencyKey);
    expect(journal.snapshot().drawingGroups[0].resourceIds).toEqual(['fresh-group-drawing']);
  });

  it('uses entry CAS so remove + re-add never receives the stale host resource id', async () => {
    const state = new ChartStateJournal();
    const journal = new LegacyChartJournal(state);
    journal.recordIndicator({ type: 'RSI', params: [14] }, AAPL, 'old-rsi');
    const oldEntryId = journal.snapshot().indicators[0].entryId;
    const hostIndicators = new Set<string>();
    let releaseOld!: () => void;
    const oldGate = new Promise<void>((resolve) => { releaseOld = resolve; });
    const live = chart(AAPL);
    vi.mocked(live.getContext).mockImplementation(async () => ({
      identity: AAPL,
      totalCandles: 300,
      indicators: [...hostIndicators].map((id) => ({ id, type: 'RSI', params: [14] })),
      drawings: [],
      alerts: [],
    }));
    vi.mocked(live.execute).mockImplementation(async (command) => {
      if (command.action === 'addIndicator') {
        await oldGate;
        hostIndicators.add('old-late-rsi');
        return { success: true, resourceIds: ['old-late-rsi'] };
      }
      if (command.action === 'removeIndicator') {
        hostIndicators.delete(command.indicatorId);
        return { success: true };
      }
      return { success: true };
    });

    const pending = new ReconcileChartStateUseCase(live, journal).execute();
    await vi.waitFor(() => expect(live.execute).toHaveBeenCalledOnce());
    journal.removeIndicator(AAPL, 'not-bound-yet', 'RSI', [14]);
    journal.recordIndicator({ type: 'RSI', params: [14] }, AAPL, 'new-rsi');
    hostIndicators.add('new-rsi');
    releaseOld();

    await expect(pending).resolves.toMatchObject({ status: 'superseded', failures: [] });
    expect(hostIndicators).toEqual(new Set(['new-rsi']));
    const current = journal.snapshot().indicators[0];
    expect(current.entryId).not.toBe(oldEntryId);
    expect(current.resourceIds).toEqual(['new-rsi']);
  });

  it('restores current individual drawing group and CAS-binds fresh host ids', async () => {
    const state = new ChartStateJournal();
    const journal = new LegacyChartJournal(state);
    const oldDrawing = { ...DRAWING, groupId: 'romaco-mcp/manual' };
    const latestDrawing = {
      ...DRAWING,
      groupId: 'romaco-mcp/manual',
      points: [{ timestamp: 5, price: 140 }, { timestamp: 6, price: 150 }],
    };
    journal.recordDrawing(oldDrawing, AAPL, 'old-drawing-host');
    let hostDrawings: readonly typeof oldDrawing[] = [];
    let releaseOld!: () => void;
    const oldGate = new Promise<void>((resolve) => { releaseOld = resolve; });
    const live = chart(AAPL);
    vi.mocked(live.execute).mockImplementation(async (command) => {
      if (command.action === 'addDrawing') {
        await oldGate;
        hostDrawings = [oldDrawing];
        return { success: true, resourceIds: ['old-drawing'] };
      }
      return { success: true };
    });
    vi.mocked(live.replaceDrawingGroup).mockImplementation(async (command) => {
      hostDrawings = command.drawings as readonly typeof oldDrawing[];
      return { success: true, resourceIds: ['fresh-drawing'] };
    });

    const pending = new ReconcileChartStateUseCase(live, journal).execute();
    await vi.waitFor(() => expect(live.execute).toHaveBeenCalledOnce());
    state.removeDrawingsByGroupForIdentity('romaco-mcp/manual', AAPL);
    journal.recordDrawing(latestDrawing, AAPL);
    releaseOld();

    await expect(pending).resolves.toMatchObject({ status: 'superseded', failures: [] });
    expect(hostDrawings).toEqual([latestDrawing]);
    expect(journal.snapshot().drawings[0].resourceIds).toEqual(['fresh-drawing']);
  });

  it('keeps no-id compensation debt, never semantic-deletes duplicate user alerts, and scopes retry by identity', async () => {
    const state = new ChartStateJournal();
    const journal = new LegacyChartJournal(state);
    journal.recordAlert(ALERT, AAPL, 'old-alert');
    const tslaSameChart: ChartIdentity = { ...AAPL, symbol: 'TSLA' };
    let identity: ChartIdentity = AAPL;
    const hostAlerts = new Map<string, { price: number; direction: 'above' | 'below' | 'cross' }>();
    const hostIndicators = new Set<string>();
    let releaseAlert!: () => void;
    const alertGate = new Promise<void>((resolve) => { releaseAlert = resolve; });
    const live = chart(AAPL);
    vi.mocked(live.getContext).mockImplementation(async () => ({
      identity,
      totalCandles: 300,
      indicators: [...hostIndicators].map((id) => ({ id, type: 'EMA', params: [20] })),
      drawings: [],
      alerts: [...hostAlerts].map(([id, alert]) => ({ id, ...alert })),
    }));
    vi.mocked(live.execute).mockImplementation(async (command) => {
      if (command.action === 'addAlert') {
        await alertGate;
        hostAlerts.set('agent-late-alert', { price: command.price, direction: command.options?.direction ?? 'cross' });
        return { success: true, resourceIds: [] };
      }
      if (command.action === 'addIndicator') {
        hostIndicators.add('tsla-ema');
        return { success: true, resourceIds: ['tsla-ema'] };
      }
      if (command.action === 'removeAlert') {
        throw new Error(`unsafe semantic cleanup attempted for ${command.alertId}`);
      }
      return { success: true };
    });
    const useCase = new ReconcileChartStateUseCase(live, journal);

    const first = useCase.execute();
    await vi.waitFor(() => expect(live.execute).toHaveBeenCalledOnce());
    journal.removeAlert(AAPL, 'not-bound-yet', ALERT.price, 'above');
    hostAlerts.set('user-lookalike-alert', { price: ALERT.price, direction: 'above' });
    releaseAlert();

    await expect(first).resolves.toMatchObject({
      status: 'indeterminate',
      failures: [{ message: expect.stringMatching(/no exact resource id/i) }],
    });
    await expect(useCase.execute()).resolves.toMatchObject({ status: 'indeterminate' });
    expect(hostAlerts.has('user-lookalike-alert')).toBe(true);
    expect(hostAlerts.has('agent-late-alert')).toBe(true);
    expect(vi.mocked(live.execute).mock.calls.some(([command]) => command.action === 'removeAlert')).toBe(false);

    identity = tslaSameChart;
    journal.recordIndicator({ type: 'EMA', params: [20] }, tslaSameChart, 'old-tsla-ema');
    await expect(useCase.execute()).resolves.toMatchObject({ status: 'reconciled', applied: 1 });
    expect(hostIndicators).toEqual(new Set(['tsla-ema']));

    identity = AAPL;
    await expect(useCase.execute()).resolves.toMatchObject({ status: 'indeterminate' });
  });

  it('records durable indeterminate debt when response loss races desired removal', async () => {
    const state = new ChartStateJournal();
    const journal = new LegacyChartJournal(state);
    journal.recordIndicator({ type: 'RSI', params: [14] }, AAPL, 'old-rsi');
    const hostIndicators = new Set<string>();
    let releaseWrite!: () => void;
    const writeGate = new Promise<void>((resolve) => { releaseWrite = resolve; });
    const live = chart(AAPL);
    vi.mocked(live.getContext).mockImplementation(async () => ({
      identity: AAPL,
      totalCandles: 300,
      indicators: [...hostIndicators].map((id) => ({ id, type: 'RSI', params: [14] })),
      drawings: [],
      alerts: [],
    }));
    vi.mocked(live.execute).mockImplementation(async (command) => {
      if (command.action === 'addIndicator') {
        await writeGate;
        hostIndicators.add('ambiguous-rsi');
        throw new Error('response lost after host apply');
      }
      if (command.action === 'removeIndicator') {
        throw new Error('must not guess ambiguous resource id');
      }
      return { success: true };
    });
    const useCase = new ReconcileChartStateUseCase(live, journal);

    const first = useCase.execute();
    await vi.waitFor(() => expect(live.execute).toHaveBeenCalledOnce());
    journal.removeIndicator(AAPL, 'not-bound-yet', 'RSI', [14]);
    releaseWrite();

    await expect(first).resolves.toMatchObject({
      status: 'indeterminate',
      failures: [{ message: expect.stringMatching(/no exact resource id/i) }],
    });
    expect(hostIndicators).toEqual(new Set(['ambiguous-rsi']));
    await expect(useCase.execute()).resolves.toMatchObject({ status: 'indeterminate' });
    expect(vi.mocked(live.execute).mock.calls).toHaveLength(1);
  });

  it('retries unready chart and cancels older reconciliation generation', async () => {
    const state = desiredState({
      ...emptySnapshot(),
      indicators: [{ command: RSI, identity: AAPL, resourceIds: ['old-rsi'] }],
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
