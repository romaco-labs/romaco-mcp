import type { ChartJournalPort } from '../application/ports/chartJournal.js';
import type { ChartPresetIndicator } from '../application/ports/chartPresetCatalog.js';
import type { ChartIdentity } from '../domain/chart/model.js';
import type { ChartCommand } from '../domain/chart/model.js';
import { chartState } from '../chartState.js';

export class LegacyChartJournal implements ChartJournalPort {
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

  replaceDrawingGroup(
    groupId: string,
    drawings: readonly Extract<ChartCommand, { action: 'addDrawing' }>[],
    identity: ChartIdentity,
    resourceIds: readonly string[] = [],
  ): void {
    chartState.removeDrawingsByGroup(groupId);
    drawings.forEach((drawing, index) => {
      chartState.recordDrawing(drawing, identity.symbol ?? null, resourceIds[index]);
    });
  }
}
