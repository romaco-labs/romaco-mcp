import type { ChartCommand, ChartIdentity } from '../../domain/chart/model.js';

export interface ChartDrawingJournalPort {
  recordDrawing(
    drawing: Extract<ChartCommand, { action: 'addDrawing' }>,
    identity: ChartIdentity,
    resourceId?: string,
  ): void;
}
