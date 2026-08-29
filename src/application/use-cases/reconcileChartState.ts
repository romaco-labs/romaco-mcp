import type { ChartPort } from '../ports/chart.js';
import type {
  ChartDesiredStatePort,
  ChartDesiredStateSnapshot,
  DesiredChartEntry,
  ReplayableChartCommand,
} from '../ports/chartDesiredState.js';
import type {
  ChartAlertState,
  ChartCommand,
  ChartContext,
  ChartDrawingState,
  ChartIdentity,
  ChartIndicatorState,
  ReplaceDrawingGroupCommand,
} from '../../domain/chart/model.js';

const READY_RETRY_DELAY_MS = 1_500;
const READY_RETRY_ATTEMPTS = 8;
const STALE_COMPENSATION_ATTEMPTS = 3;

export interface ReconcileChartStateOptions {
  attempts?: number;
  delayMs?: number;
}

export interface ReconcileFailure {
  action: ReplayableChartCommand['action'] | 'replaceDrawingGroup';
  message: string;
}

export interface ReconcileChartStateResult {
  status: 'empty' | 'superseded' | 'not-ready' | 'indeterminate' | 'reconciled';
  applied: number;
  skippedIdentity: number;
  failures: readonly ReconcileFailure[];
  notReadyReason?: string;
}

export type Delay = (milliseconds: number) => Promise<void>;

const defaultDelay: Delay = (milliseconds) => new Promise((resolve) => {
  setTimeout(resolve, milliseconds);
});

function sameIdentity(expected: ChartIdentity, actual: ChartIdentity): boolean {
  return expected.chartId === actual.chartId
    && expected.symbol !== undefined
    && expected.symbol === actual.symbol
    && expected.timeframe !== undefined
    && expected.timeframe === actual.timeframe;
}

const numberEqual = (left: number, right: number): boolean => Math.abs(left - right) < 1e-9;

function paramsEqual(left: readonly number[] = [], right: readonly number[] = []): boolean {
  return left.length === right.length && left.every((value, index) => numberEqual(value, right[index]));
}

function pointsEqual(
  left: ChartDrawingState['points'] = [],
  right: Extract<ChartCommand, { action: 'addDrawing' }>['points'] = [],
): boolean {
  return left.length === right.length
    && left.every((point, index) => (
      numberEqual(point.timestamp, right[index].timestamp)
      && numberEqual(point.price, right[index].price)
    ));
}

function hasIndicator(
  existing: readonly ChartIndicatorState[],
  wanted: Extract<ChartCommand, { action: 'addIndicator' }>,
): ChartIndicatorState | undefined {
  return existing.find((candidate) => (
    candidate.type.toLowerCase() === wanted.indicatorType.toLowerCase()
    && paramsEqual(candidate.params, wanted.params)
  ));
}

function hasDrawing(
  existing: readonly ChartDrawingState[],
  wanted: Extract<ChartCommand, { action: 'addDrawing' }>,
): ChartDrawingState | undefined {
  return existing.find((candidate) => (
    candidate.type.toLowerCase() === wanted.drawingType.toLowerCase()
    && pointsEqual(candidate.points, wanted.points)
  ));
}

function hasAlert(
  existing: readonly ChartAlertState[],
  wanted: Extract<ChartCommand, { action: 'addAlert' }>,
): ChartAlertState | undefined {
  return existing.find((candidate) => (
    numberEqual(candidate.price, wanted.price)
    && candidate.direction === (wanted.options?.direction ?? 'cross')
  ));
}

function hasOwnedIndicator(
  existing: readonly ChartIndicatorState[],
  entry: DesiredChartEntry<Extract<ChartCommand, { action: 'addIndicator' }>>,
): ChartIndicatorState | undefined {
  return existing.find((candidate) => (
    candidate.id !== undefined
    && entry.resourceIds.includes(candidate.id)
    && hasIndicator([candidate], entry.command) !== undefined
  ));
}

function hasOwnedDrawing(
  existing: readonly ChartDrawingState[],
  entry: DesiredChartEntry<Extract<ChartCommand, { action: 'addDrawing' }>>,
): ChartDrawingState | undefined {
  return existing.find((candidate) => (
    candidate.id !== undefined
    && entry.resourceIds.includes(candidate.id)
    && hasDrawing([candidate], entry.command) !== undefined
  ));
}

function hasOwnedAlert(
  existing: readonly ChartAlertState[],
  entry: DesiredChartEntry<Extract<ChartCommand, { action: 'addAlert' }>>,
): ChartAlertState | undefined {
  return existing.find((candidate) => (
    candidate.id !== undefined
    && entry.resourceIds.includes(candidate.id)
    && hasAlert([candidate], entry.command) !== undefined
  ));
}

function drawingCommandEqual(
  left: Extract<ChartCommand, { action: 'addDrawing' }>,
  right: Extract<ChartCommand, { action: 'addDrawing' }>,
): boolean {
  return left.drawingType.toLowerCase() === right.drawingType.toLowerCase()
    && left.groupId === right.groupId
    && left.label === right.label
    && left.paneId === right.paneId
    && JSON.stringify(left.style ?? {}) === JSON.stringify(right.style ?? {})
    && pointsEqual(left.points, right.points);
}

function entriesFor(
  snapshot: ChartDesiredStateSnapshot,
  command: ReplayableChartCommand,
): readonly DesiredChartEntry<ReplayableChartCommand>[] {
  if (command.action === 'addIndicator') return snapshot.indicators;
  if (command.action === 'addAlert') return snapshot.alerts;
  return snapshot.drawings;
}

function findDesiredEntry(
  snapshot: ChartDesiredStateSnapshot,
  wanted: DesiredChartEntry<ReplayableChartCommand>,
): DesiredChartEntry<ReplayableChartCommand> | undefined {
  return entriesFor(snapshot, wanted.command).find((entry) => (
    entry.entryId === wanted.entryId && entry.entryVersion === wanted.entryVersion
  ));
}

function findDesiredGroup(
  snapshot: ChartDesiredStateSnapshot,
  wanted: DesiredChartEntry<ReplaceDrawingGroupCommand>,
): DesiredChartEntry<ReplaceDrawingGroupCommand> | undefined {
  return snapshot.drawingGroups.find((entry) => (
    sameIdentity(wanted.identity, entry.identity)
    && entry.command.groupId === wanted.command.groupId
  ));
}

function drawingGroupPayloadEqual(
  left: ReplaceDrawingGroupCommand,
  right: ReplaceDrawingGroupCommand,
): boolean {
  return left.groupId === right.groupId
    && left.drawings.length === right.drawings.length
    && left.drawings.every((drawing, index) => drawingCommandEqual(drawing, right.drawings[index]));
}

function stateSize(state: ChartDesiredStateSnapshot): number {
  return state.indicators.length
    + state.drawings.length
    + state.drawingGroups.length
    + state.alerts.length;
}

interface IndividualCompensationDebt {
  kind: 'individual';
  key: string;
  entry: DesiredChartEntry<ReplayableChartCommand>;
  resourceIds: readonly string[];
  hostState: 'present' | 'absent' | 'unknown';
}

interface GroupCompensationDebt {
  kind: 'group';
  key: string;
  entry: DesiredChartEntry<ReplaceDrawingGroupCommand>;
  resourceIds: readonly string[];
  hostState: 'present' | 'unknown';
}

type CompensationDebt = IndividualCompensationDebt | GroupCompensationDebt;

export class ReconcileChartStateUseCase {
  private generation = 0;
  private tail: Promise<void> = Promise.resolve();
  private readonly debts = new Map<string, CompensationDebt>();

  constructor(
    private readonly chart: ChartPort,
    private readonly desiredState: ChartDesiredStatePort,
    private readonly delay: Delay = defaultDelay,
  ) {}

  execute(options: ReconcileChartStateOptions = {}): Promise<ReconcileChartStateResult> {
    const generation = ++this.generation;
    const run = this.tail.then(
      () => this.executeSerialized(generation, options),
      () => this.executeSerialized(generation, options),
    );
    this.tail = run.then(() => undefined, () => undefined);
    return run;
  }

  private async executeSerialized(
    generation: number,
    options: ReconcileChartStateOptions,
  ): Promise<ReconcileChartStateResult> {
    const initial = this.stableDesiredState();
    if (!initial) return this.result('superseded');
    if (stateSize(initial.snapshot) === 0 && this.debts.size === 0) return this.result('empty');

    const attempts = Math.max(1, options.attempts ?? READY_RETRY_ATTEMPTS);
    const delayMs = Math.max(0, options.delayMs ?? READY_RETRY_DELAY_MS);
    let context: ChartContext | null = null;
    let lastError: unknown = null;

    for (let attempt = 1; attempt <= attempts; attempt += 1) {
      try {
        const candidate = await this.chart.getContext({ includeCandles: false });
        if (candidate.totalCandles === undefined || candidate.totalCandles > 0) {
          context = candidate;
          break;
        }
        lastError = new Error('chart has no candles loaded yet');
      } catch (error) {
        lastError = error;
      }
      if (generation !== this.generation) return this.result('superseded');
      if (attempt < attempts) await this.delay(delayMs);
    }

    if (!context) {
      return {
        ...this.result('not-ready'),
        notReadyReason: lastError instanceof Error ? lastError.message : String(lastError),
      };
    }

    const hadMatchingDebts = [...this.debts.values()].some((debt) => (
      sameIdentity(debt.entry.identity, context!.identity)
    ));
    const debtRetry = await this.retryCompensationDebts(context.identity);
    if (debtRetry.pending) {
      return { status: 'indeterminate', applied: 0, skippedIdentity: 0, failures: debtRetry.failures };
    }
    if (generation !== this.generation) return this.result('superseded');
    if (hadMatchingDebts) {
      try {
        context = await this.chart.getContext({ includeCandles: false });
      } catch (error) {
        return {
          ...this.result('not-ready'),
          notReadyReason: error instanceof Error ? error.message : String(error),
        };
      }
    }

    const latest = this.stableDesiredState();
    if (!latest) return this.result('superseded');
    if (stateSize(latest.snapshot) === 0) return this.result('empty');
    return this.applyDesiredState(latest.snapshot, context, generation, latest.revision);
  }

  private async applyDesiredState(
    desired: ChartDesiredStateSnapshot,
    context: ChartContext,
    generation: number,
    revision: number,
  ): Promise<ReconcileChartStateResult> {
    let applied = 0;
    let skippedIdentity = 0;
    let unreplayable = false;
    const failures: ReconcileFailure[] = [];
    const isCurrent = (): boolean => (
      generation === this.generation
      && revision === this.desiredState.structuralRevision()
    );
    const interruptedStatus = (): 'superseded' | 'indeterminate' => (
      this.hasDebtFor(context.identity) ? 'indeterminate' : 'superseded'
    );
    const apply = async (
      entry: DesiredChartEntry<ReplayableChartCommand>,
      present: { id?: string } | undefined,
    ): Promise<boolean> => {
      if (!isCurrent()) return false;
      if (!sameIdentity(entry.identity, context.identity)) {
        skippedIdentity += 1;
        return true;
      }
      if (entry.resourceIds.length === 0) {
        unreplayable = true;
        failures.push({
          action: entry.command.action,
          message:
            'desired resource has no stable host id; replay skipped to avoid claiming or duplicating user-owned state',
        });
        return true;
      }
      if (present) {
        if (present.id) {
          this.desiredState.bindReplayedResources(entry.entryId, entry.entryVersion, [present.id]);
        }
        return isCurrent();
      }
      try {
        const result = await this.chart.execute(entry.command, { expectedIdentity: entry.identity });
        if (!result.success) throw new Error(result.error ?? 'chart rejected action');
        if (revision !== this.desiredState.structuralRevision()) {
          failures.push(...await this.compensateStaleReplay(entry, result.resourceIds ?? []));
          return false;
        }
        this.desiredState.bindReplayedResources(
          entry.entryId,
          entry.entryVersion,
          result.resourceIds ?? [],
        );
        if (generation !== this.generation) return false;
        applied += 1;
      } catch (error) {
        if (revision !== this.desiredState.structuralRevision()) {
          failures.push(...await this.compensateStaleReplay(entry, [], 'unknown'));
          return false;
        }
        if (!isCurrent()) return false;
        failures.push({
          action: entry.command.action,
          message: error instanceof Error ? error.message : String(error),
        });
      }
      return isCurrent();
    };

    for (const entry of desired.indicators) {
      if (!await apply(entry, hasOwnedIndicator(context.indicators ?? [], entry))) {
        return { status: interruptedStatus(), applied, skippedIdentity, failures };
      }
    }
    for (const entry of desired.drawingGroups) {
      if (!isCurrent()) return { status: 'superseded', applied, skippedIdentity, failures };
      if (!sameIdentity(entry.identity, context.identity)) {
        skippedIdentity += 1;
        continue;
      }
      try {
        const result = await this.chart.replaceDrawingGroup({
          ...entry.command,
          expectedIdentity: entry.identity,
        });
        if (!result.success) throw new Error(result.error ?? 'chart rejected atomic replacement');
        if (revision !== this.desiredState.structuralRevision()) {
          failures.push(...await this.compensateStaleGroup(entry, result.resourceIds ?? []));
          return { status: interruptedStatus(), applied, skippedIdentity, failures };
        }
        this.desiredState.bindReplayedResources(
          entry.entryId,
          entry.entryVersion,
          result.resourceIds ?? [],
        );
        if (generation !== this.generation) {
          return { status: 'superseded', applied, skippedIdentity, failures };
        }
        applied += 1;
      } catch (error) {
        if (revision !== this.desiredState.structuralRevision()) {
          failures.push(...await this.compensateStaleGroup(entry, [], 'unknown'));
          return { status: interruptedStatus(), applied, skippedIdentity, failures };
        }
        if (!isCurrent()) return { status: 'superseded', applied, skippedIdentity, failures };
        failures.push({
          action: 'replaceDrawingGroup',
          message: error instanceof Error ? error.message : String(error),
        });
      }
    }
    for (const entry of desired.drawings) {
      if (!await apply(entry, hasOwnedDrawing(context.drawings ?? [], entry))) {
        return { status: interruptedStatus(), applied, skippedIdentity, failures };
      }
    }
    for (const entry of desired.alerts) {
      if (!await apply(entry, hasOwnedAlert(context.alerts ?? [], entry))) {
        return { status: interruptedStatus(), applied, skippedIdentity, failures };
      }
    }

    return {
      status: unreplayable ? 'indeterminate' : 'reconciled',
      applied,
      skippedIdentity,
      failures,
    };
  }

  private stableDesiredState(): { revision: number; snapshot: ChartDesiredStateSnapshot } | null {
    for (let attempt = 0; attempt < STALE_COMPENSATION_ATTEMPTS; attempt += 1) {
      const revision = this.desiredState.structuralRevision();
      const snapshot = this.desiredState.snapshot();
      if (revision === this.desiredState.structuralRevision()) return { revision, snapshot };
    }
    return null;
  }

  private async compensateStaleReplay(
    entry: DesiredChartEntry<ReplayableChartCommand>,
    resourceIds: readonly string[],
    hostState: IndividualCompensationDebt['hostState'] = 'present',
  ): Promise<ReconcileFailure[]> {
    const debt: IndividualCompensationDebt = {
      kind: 'individual',
      key: `individual:${entry.entryId}:${entry.entryVersion}`,
      entry,
      resourceIds,
      hostState,
    };
    const failure = await this.resolveIndividualDebt(debt);
    if (!failure) return [];
    this.debts.set(debt.key, debt);
    return [failure];
  }

  private async compensateStaleGroup(
    entry: DesiredChartEntry<ReplaceDrawingGroupCommand>,
    resourceIds: readonly string[],
    hostState: GroupCompensationDebt['hostState'] = 'present',
  ): Promise<ReconcileFailure[]> {
    const debt: GroupCompensationDebt = {
      kind: 'group',
      key: `group:${entry.entryId}:${entry.entryVersion}`,
      entry,
      resourceIds,
      hostState,
    };
    const failure = await this.resolveGroupDebt(debt);
    if (!failure) return [];
    this.debts.set(debt.key, debt);
    return [failure];
  }

  private async retryCompensationDebts(
    identity: ChartIdentity,
  ): Promise<{ failures: ReconcileFailure[]; pending: boolean }> {
    const failures: ReconcileFailure[] = [];
    for (const [key, debt] of [...this.debts]) {
      if (!sameIdentity(debt.entry.identity, identity)) continue;
      const failure = debt.kind === 'individual'
        ? await this.resolveIndividualDebt(debt)
        : await this.resolveGroupDebt(debt);
      if (failure) failures.push(failure);
      else this.debts.delete(key);
    }
    return {
      failures,
      pending: [...this.debts.values()].some((debt) => (
        sameIdentity(debt.entry.identity, identity)
      )),
    };
  }

  private hasDebtFor(identity: ChartIdentity): boolean {
    return [...this.debts.values()].some((debt) => sameIdentity(debt.entry.identity, identity));
  }

  private async resolveIndividualDebt(
    debt: IndividualCompensationDebt,
  ): Promise<ReconcileFailure | null> {
    for (let attempt = 0; attempt < STALE_COMPENSATION_ATTEMPTS; attempt += 1) {
      const stable = this.stableDesiredState();
      if (!stable) continue;
      const current = findDesiredEntry(stable.snapshot, debt.entry);
      try {
        if (current && debt.hostState !== 'unknown') {
          if (debt.hostState === 'absent') {
            const reapplied = await this.chart.execute(current.command, { expectedIdentity: current.identity });
            if (!reapplied.success) throw new Error(reapplied.error ?? 'chart rejected stale-state restoration');
            debt.resourceIds = reapplied.resourceIds ?? [];
            debt.hostState = 'present';
          }
          if (stable.revision === this.desiredState.structuralRevision()) {
            const bound = this.desiredState.bindReplayedResources(
              current.entryId,
              current.entryVersion,
              debt.resourceIds,
            );
            if (bound) return null;
          }
          continue;
        }

        if (debt.entry.command.action === 'addDrawing') {
          const groupId = debt.entry.command.groupId;
          if (!groupId) throw new Error('cannot compensate ungrouped drawing replay safely');
          const currentDrawingEntries = stable.snapshot.drawings.filter((candidate) => (
            sameIdentity(debt.entry.identity, candidate.identity)
            && candidate.command.groupId === groupId
          ));
          const currentGroup = stable.snapshot.drawingGroups.find((candidate) => (
            sameIdentity(debt.entry.identity, candidate.identity)
            && candidate.command.groupId === groupId
          ));
          const restored = await this.chart.replaceDrawingGroup({
            groupId,
            drawings: currentGroup?.command.drawings
              ?? currentDrawingEntries.map((candidate) => candidate.command),
            expectedIdentity: debt.entry.identity,
            idempotencyKey:
              `${debt.entry.identity.chartId}:${groupId}:stale-compensation:`
              + `${stable.revision}:${attempt}:${debt.entry.entryId}`,
          });
          if (!restored.success) throw new Error(restored.error ?? 'chart rejected stale drawing compensation');
          if (stable.revision !== this.desiredState.structuralRevision()) continue;
          if (currentGroup) {
            if (!this.desiredState.bindReplayedResources(
              currentGroup.entryId,
              currentGroup.entryVersion,
              restored.resourceIds ?? [],
            )) continue;
          } else {
            const allBound = currentDrawingEntries.every((entry, index) => (
              this.desiredState.bindReplayedResources(
                entry.entryId,
                entry.entryVersion,
                restored.resourceIds?.[index] ? [restored.resourceIds[index]] : [],
              )
            ));
            if (!allBound) continue;
          }
          return null;
        }

        if (current && debt.hostState === 'unknown') {
          throw new Error(`stale ${debt.entry.command.action} outcome is ambiguous after response loss`);
        }

        if (debt.hostState !== 'absent') {
          const resourceId = debt.resourceIds[0];
          if (!resourceId) {
            throw new Error(`stale ${debt.entry.command.action} returned no exact resource id`);
          }
          const inverse: ChartCommand = debt.entry.command.action === 'addIndicator'
            ? { action: 'removeIndicator', indicatorId: resourceId }
            : { action: 'removeAlert', alertId: resourceId };
          const removed = await this.chart.execute(inverse, { expectedIdentity: debt.entry.identity });
          if (!removed.success) throw new Error(removed.error ?? 'chart rejected stale-resource removal');
          debt.hostState = 'absent';
        }
        if (stable.revision === this.desiredState.structuralRevision()) return null;
      } catch (error) {
        return {
          action: debt.entry.command.action,
          message: `stale replay compensation failed: ${error instanceof Error ? error.message : String(error)}`,
        };
      }
    }
    return {
      action: debt.entry.command.action,
      message: 'stale replay compensation did not converge after 3 revisions',
    };
  }

  private async resolveGroupDebt(debt: GroupCompensationDebt): Promise<ReconcileFailure | null> {
    for (let attempt = 0; attempt < STALE_COMPENSATION_ATTEMPTS; attempt += 1) {
      const stable = this.stableDesiredState();
      if (!stable) continue;
      const current = findDesiredGroup(stable.snapshot, debt.entry);
      try {
        if (
          current
          && debt.hostState === 'present'
          && current.entryId === debt.entry.entryId
          && current.entryVersion === debt.entry.entryVersion
          && drawingGroupPayloadEqual(current.command, debt.entry.command)
        ) {
          if (
            stable.revision === this.desiredState.structuralRevision()
            && this.desiredState.bindReplayedResources(
              current.entryId,
              current.entryVersion,
              debt.resourceIds,
            )
          ) return null;
          continue;
        }
        const replacement = await this.chart.replaceDrawingGroup({
          groupId: debt.entry.command.groupId,
          drawings: current?.command.drawings ?? [],
          expectedIdentity: debt.entry.identity,
          // A fresh key bypasses a host cache for a newer workflow key that an
          // older in-flight replacement overwrote after that cache entry formed.
          idempotencyKey:
            `${debt.entry.identity.chartId}:${debt.entry.command.groupId}:stale-compensation:`
            + `${stable.revision}:${attempt}:${current?.entryId ?? 'removed'}:${current?.entryVersion ?? 0}`,
        });
        if (!replacement.success) throw new Error(replacement.error ?? 'chart rejected stale-group compensation');
        if (stable.revision !== this.desiredState.structuralRevision()) continue;
        if (current && !this.desiredState.bindReplayedResources(
          current.entryId,
          current.entryVersion,
          replacement.resourceIds ?? [],
        )) continue;
        return null;
      } catch (error) {
        return {
          action: 'replaceDrawingGroup',
          message: `stale replay compensation failed: ${error instanceof Error ? error.message : String(error)}`,
        };
      }
    }
    return {
      action: 'replaceDrawingGroup',
      message: 'stale replay compensation did not converge after 3 revisions',
    };
  }

  private result(status: ReconcileChartStateResult['status']): ReconcileChartStateResult {
    return { status, applied: 0, skippedIdentity: 0, failures: [] };
  }
}
