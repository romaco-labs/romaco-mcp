import type { ChartIdentity } from '../../domain/chart/model.js';
import type { ChartPresetIndicator } from './chartPresetCatalog.js';
import type { ChartCommand } from '../../domain/chart/model.js';

export interface ChartJournalPort {
  recordIndicator(
    indicator: ChartPresetIndicator,
    identity: ChartIdentity,
    resourceId?: string,
  ): void;
  replaceDrawingGroup(
    groupId: string,
    drawings: readonly Extract<ChartCommand, { action: 'addDrawing' }>[],
    identity: ChartIdentity,
    idempotencyKey: string,
    resourceIds?: readonly string[],
  ): void;
}
