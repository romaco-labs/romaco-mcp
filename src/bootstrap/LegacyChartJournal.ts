import type { ChartJournalPort } from '../application/ports/chartJournal.js';
import type { ChartDrawingJournalPort } from '../application/ports/chartDrawingJournal.js';
import type { ChartPresetIndicator } from '../application/ports/chartPresetCatalog.js';
import type { ChartIdentity } from '../domain/chart/model.js';
import type { ChartCommand } from '../domain/chart/model.js';
import { chartState } from '../chartState.js';

export class LegacyChartJournal implements ChartJournalPort, ChartDrawingJournalPort {
  recordIndicator(
    indicator: ChartPresetIndicator,
    identity: ChartIdentity,
    resourceId?: string,
  ): void {
    chartState.recordIndicator(
      { action: 'addIndicator', indicatorType: indicator.type, params: indicator.params },
      identity.symbol ?? null,
      resourceId,
    );
  }

  recordDrawing(
    drawing: Extract<ChartCommand, { action: 'addDrawing' }>,
    identity: ChartIdentity,
    resourceId?: string,
  ): void {
    chartState.recordDrawing(drawing, identity, resourceId);
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
    chartState.replaceDrawingGroup({
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
}
