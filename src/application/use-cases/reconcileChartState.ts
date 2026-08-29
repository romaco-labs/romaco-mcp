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

export interface ReconcileChartStateOptions {
  attempts?: number;
  delayMs?: number;
}

export interface ReconcileFailure {
  action: ReplayableChartCommand['action'] | 'replaceDrawingGroup';
  message: string;
}

export interface ReconcileChartStateResult {
  status: 'empty' | 'superseded' | 'not-ready' | 'reconciled';
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
): boolean {
  return existing.some((candidate) => (
    candidate.type.toLowerCase() === wanted.indicatorType.toLowerCase()
    && paramsEqual(candidate.params, wanted.params)
  ));
}

function hasDrawing(
  existing: readonly ChartDrawingState[],
  wanted: Extract<ChartCommand, { action: 'addDrawing' }>,
): boolean {
  return existing.some((candidate) => (
    candidate.type.toLowerCase() === wanted.drawingType.toLowerCase()
    && pointsEqual(candidate.points, wanted.points)
  ));
}

function hasAlert(
  existing: readonly ChartAlertState[],
  wanted: Extract<ChartCommand, { action: 'addAlert' }>,
): boolean {
  return existing.some((candidate) => (
    numberEqual(candidate.price, wanted.price)
    && candidate.direction === (wanted.options?.direction ?? 'cross')
  ));
}

function stateSize(state: ChartDesiredStateSnapshot): number {
  return state.indicators.length
    + state.drawings.length
    + state.drawingGroups.length
    + state.alerts.length;
}

export class ReconcileChartStateUseCase {
  private generation = 0;

  constructor(
    private readonly chart: ChartPort,
    private readonly desiredState: ChartDesiredStatePort,
    private readonly delay: Delay = defaultDelay,
  ) {}

  async execute(options: ReconcileChartStateOptions = {}): Promise<ReconcileChartStateResult> {
    const generation = ++this.generation;
    const initialDesired = this.desiredState.snapshot();
    if (stateSize(initialDesired) === 0) return this.result('empty');

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

    if (generation !== this.generation) return this.result('superseded');
    if (!context) {
      return {
        ...this.result('not-ready'),
        notReadyReason: lastError instanceof Error ? lastError.message : String(lastError),
      };
    }

    // Desired state can change while chart readiness retries are in flight.
    // Recapture only after context is ready so removed entries never resurrect.
    const desired = this.desiredState.snapshot();
    return this.applyDesiredState(desired, context, generation);
  }

  private async applyDesiredState(
    desired: ChartDesiredStateSnapshot,
    context: ChartContext,
    generation: number,
  ): Promise<ReconcileChartStateResult> {
    let applied = 0;
    let skippedIdentity = 0;
    const failures: ReconcileFailure[] = [];
    const apply = async (
      entry: DesiredChartEntry<ReplayableChartCommand>,
      present: boolean,
    ): Promise<boolean> => {
      if (generation !== this.generation) return false;
      if (!sameIdentity(entry.identity, context.identity)) {
        skippedIdentity += 1;
        return true;
      }
      if (present) return true;
      try {
        const result = await this.chart.execute(entry.command, { expectedIdentity: entry.identity });
        if (generation !== this.generation) return false;
        if (!result.success) throw new Error(result.error ?? 'chart rejected action');
        this.desiredState.bindReplayedResources(
          entry.command,
          entry.identity,
          result.resourceIds ?? [],
        );
        applied += 1;
      } catch (error) {
        failures.push({
          action: entry.command.action,
          message: error instanceof Error ? error.message : String(error),
        });
      }
      return generation === this.generation;
    };

    for (const entry of desired.indicators) {
      if (!await apply(entry, hasIndicator(context.indicators ?? [], entry.command))) {
        return { status: 'superseded', applied, skippedIdentity, failures };
      }
    }
    for (const entry of desired.drawingGroups) {
      if (generation !== this.generation) {
        return { status: 'superseded', applied, skippedIdentity, failures };
      }
      if (!sameIdentity(entry.identity, context.identity)) {
        skippedIdentity += 1;
        continue;
      }
      try {
        const command: ReplaceDrawingGroupCommand = {
          ...entry.command,
          expectedIdentity: entry.identity,
        };
        const result = await this.chart.replaceDrawingGroup(command);
        if (generation !== this.generation) {
          return { status: 'superseded', applied, skippedIdentity, failures };
        }
        if (!result.success) throw new Error(result.error ?? 'chart rejected atomic replacement');
        this.desiredState.bindReplayedResources(
          command,
          entry.identity,
          result.resourceIds ?? [],
        );
        applied += 1;
      } catch (error) {
        failures.push({
          action: 'replaceDrawingGroup',
          message: error instanceof Error ? error.message : String(error),
        });
      }
    }
    for (const entry of desired.drawings) {
      if (!await apply(entry, hasDrawing(context.drawings ?? [], entry.command))) {
        return { status: 'superseded', applied, skippedIdentity, failures };
      }
    }
    for (const entry of desired.alerts) {
      if (!await apply(entry, hasAlert(context.alerts ?? [], entry.command))) {
        return { status: 'superseded', applied, skippedIdentity, failures };
      }
    }

    return { status: 'reconciled', applied, skippedIdentity, failures };
  }

  private result(status: ReconcileChartStateResult['status']): ReconcileChartStateResult {
    return { status, applied: 0, skippedIdentity: 0, failures: [] };
  }
}
