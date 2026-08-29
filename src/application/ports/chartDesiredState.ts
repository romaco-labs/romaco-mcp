import type {
  ChartCommand,
  ChartIdentity,
  ReplaceDrawingGroupCommand,
} from '../../domain/chart/model.js';
import type { ChartDrawingJournalPort } from './chartDrawingJournal.js';
import type { ChartJournalPort } from './chartJournal.js';

export type ReplayableChartCommand = Extract<
  ChartCommand,
  { action: 'addIndicator' | 'addDrawing' | 'addAlert' }
>;

export interface DesiredChartEntry<Command> {
  /** Stable logical entry identity; remove + re-add always allocates a new id. */
  entryId: string;
  /** CAS version for in-place slot updates such as atomic group replacement. */
  entryVersion: number;
  command: Command;
  identity: ChartIdentity;
  resourceIds: readonly string[];
}

export interface ChartDesiredStateSnapshot {
  indicators: readonly DesiredChartEntry<Extract<ChartCommand, { action: 'addIndicator' }>>[];
  drawings: readonly DesiredChartEntry<Extract<ChartCommand, { action: 'addDrawing' }>>[];
  drawingGroups: readonly DesiredChartEntry<ReplaceDrawingGroupCommand>[];
  alerts: readonly DesiredChartEntry<Extract<ChartCommand, { action: 'addAlert' }>>[];
}

/**
 * Desired chart state owned by application workflows.
 *
 * Entries without complete chartId + symbol + timeframe attribution must never
 * cross this port. Reconciliation can therefore fail closed by exact identity.
 */
export interface ChartDesiredStatePort extends ChartJournalPort, ChartDrawingJournalPort {
  recordAlert(
    alert: Extract<ChartCommand, { action: 'addAlert' }>,
    identity: ChartIdentity,
    resourceId?: string,
  ): void;
  removeIndicator(
    identity: ChartIdentity,
    resourceId: string,
    indicatorType: string,
    params?: readonly number[],
  ): void;
  removeAlert(
    identity: ChartIdentity,
    resourceId: string,
    price: number,
    direction: 'above' | 'below' | 'cross',
  ): void;
  structuralRevision(): number;
  snapshot(): ChartDesiredStateSnapshot;
  bindReplayedResources(
    entryId: string,
    entryVersion: number,
    resourceIds: readonly string[],
  ): boolean;
}
