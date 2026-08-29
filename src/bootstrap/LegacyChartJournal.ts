import type { ChartJournalPort } from '../application/ports/chartJournal.js';
import type { ChartDrawingJournalPort } from '../application/ports/chartDrawingJournal.js';
import type {
  ChartDesiredStatePort,
  ChartDesiredStateSnapshot,
  ReplayableChartCommand,
} from '../application/ports/chartDesiredState.js';
import type { ChartPresetIndicator } from '../application/ports/chartPresetCatalog.js';
import type { ChartIdentity } from '../domain/chart/model.js';
import type { ChartCommand } from '../domain/chart/model.js';
import { ChartStateJournal, chartState } from '../chartState.js';
import type { BridgeAction } from '../types.js';

function hasReplayIdentity(identity: ChartIdentity | undefined): identity is ChartIdentity & {
  symbol: string;
  timeframe: NonNullable<ChartIdentity['timeframe']>;
} {
  return Boolean(identity?.chartId && identity.symbol && identity.timeframe);
}

export class LegacyChartJournal implements ChartJournalPort, ChartDrawingJournalPort, ChartDesiredStatePort {
  constructor(private readonly state: ChartStateJournal = chartState) {}

  recordIndicator(
    indicator: ChartPresetIndicator,
    identity: ChartIdentity,
    resourceId?: string,
  ): void {
    this.state.recordIndicator(
      { action: 'addIndicator', indicatorType: indicator.type, params: indicator.params },
      identity,
      resourceId,
    );
  }

  recordDrawing(
    drawing: Extract<ChartCommand, { action: 'addDrawing' }>,
    identity: ChartIdentity,
    resourceId?: string,
  ): void {
    this.state.recordDrawing(drawing, identity, resourceId);
  }

  replaceDrawingGroup(
    groupId: string,
    drawings: readonly Extract<ChartCommand, { action: 'addDrawing' }>[],
    identity: ChartIdentity,
    idempotencyKey: string,
    resourceIds: readonly string[] = [],
  ): void {
    if (!identity.symbol || !identity.timeframe) {
      throw new Error('Drawing journal identity requires chartId, symbol, and timeframe.');
    }
    this.state.replaceDrawingGroup({
      action: 'replaceAgentDrawingGroup',
      groupId,
      idempotencyKey,
      expectedIdentity: {
        chartId: identity.chartId,
        symbol: identity.symbol,
        resolution: identity.timeframe,
      },
      drawings: drawings.map(({ drawingType, points, label, style, paneId }) => ({
        drawingType,
        points,
        label,
        style,
        paneId,
      })),
    }, identity, resourceIds);
  }

  recordAlert(
    alert: Extract<ChartCommand, { action: 'addAlert' }>,
    identity: ChartIdentity,
    resourceId?: string,
  ): void {
    this.state.recordAlert(alert, identity, resourceId);
  }

  removeIndicator(
    identity: ChartIdentity,
    resourceId: string,
    indicatorType: string,
    params: readonly number[] = [],
  ): void {
    this.state.removeIndicator(identity, resourceId, indicatorType, [...params]);
  }

  removeAlert(
    identity: ChartIdentity,
    resourceId: string,
    price: number,
    direction: 'above' | 'below' | 'cross',
  ): void {
    this.state.removeAlert(identity, resourceId, price, direction);
  }

  structuralRevision(): number {
    return this.state.structuralRevision();
  }

  snapshot(): ChartDesiredStateSnapshot {
    const snapshot = this.state.snapshot();
    const direct = <Command extends ReplayableChartCommand>(entries: typeof snapshot.indicators) => (
      entries.flatMap((entry) => {
        if (!hasReplayIdentity(entry.identity)) return [];
        return [{
          command: entry.action as Command,
          identity: { ...entry.identity },
          resourceIds: entry.resourceId ? [entry.resourceId] : [],
        }];
      })
    );
    return {
      indicators: direct<Extract<ChartCommand, { action: 'addIndicator' }>>(snapshot.indicators),
      drawings: direct<Extract<ChartCommand, { action: 'addDrawing' }>>(snapshot.drawings),
      alerts: direct<Extract<ChartCommand, { action: 'addAlert' }>>(snapshot.alerts),
      drawingGroups: snapshot.drawingGroups.flatMap((entry) => {
        if (!hasReplayIdentity(entry.identity) || entry.action.action !== 'replaceAgentDrawingGroup') return [];
        return [{
          command: {
            groupId: entry.action.groupId,
            idempotencyKey: entry.action.idempotencyKey,
            expectedIdentity: { ...entry.identity },
            drawings: entry.action.drawings.map((drawing) => ({
              action: 'addDrawing' as const,
              groupId: entry.action.action === 'replaceAgentDrawingGroup' ? entry.action.groupId : undefined,
              ...drawing,
            })),
          },
          identity: { ...entry.identity },
          resourceIds: entry.resourceIds ?? [],
        }];
      }),
    };
  }

  bindReplayedResources(
    command: ReplayableChartCommand | import('../domain/chart/model.js').ReplaceDrawingGroupCommand,
    identity: ChartIdentity,
    resourceIds: readonly string[],
  ): void {
    if (!hasReplayIdentity(identity)) return;
    if ('idempotencyKey' in command) {
      const action: Extract<BridgeAction, { action: 'replaceAgentDrawingGroup' }> = {
        action: 'replaceAgentDrawingGroup',
        groupId: command.groupId,
        idempotencyKey: command.idempotencyKey,
        expectedIdentity: {
          chartId: identity.chartId,
          symbol: identity.symbol,
          resolution: identity.timeframe,
        },
        drawings: command.drawings.map(({ drawingType, points, label, style, paneId }) => ({
          drawingType, points, label, style, paneId,
        })),
      };
      this.state.bindResourceIds(action, resourceIds, identity);
      return;
    }
    if (resourceIds[0]) this.state.bindResourceId(command as BridgeAction, resourceIds[0], identity);
  }
}
