import { ApplicationError } from '../errors.js';
import type { ChartPort } from '../ports/chart.js';
import type { ChartDrawingJournalPort } from '../ports/chartDrawingJournal.js';
import type { DrawingTemplateCatalogPort } from '../ports/drawingTemplateCatalog.js';
import type { ChartCommand, ChartIdentity } from '../../domain/chart/model.js';

type AddDrawingCommand = Extract<ChartCommand, { action: 'addDrawing' }>;

export interface AddDrawingInput extends Omit<AddDrawingCommand, 'action' | 'drawingType'> {
  drawingType: string;
}

export interface AddDrawingResult {
  drawing: AddDrawingCommand;
  drawingId?: string;
  chartIdentity: ChartIdentity;
}

function validatePoints(
  drawingType: string,
  points: AddDrawingCommand['points'],
  expectedPointCount: number | null,
): void {
  const invalidPointIndexes = points.flatMap((point, index) =>
    Number.isFinite(point.timestamp) && Number.isFinite(point.price) ? [] : [index]
  );
  if (invalidPointIndexes.length > 0) {
    throw new ApplicationError('INVALID_ARGUMENT', `${drawingType} anchors must contain finite timestamp and price values.`, {
      recovery: {
        action: 'change_input',
        instruction: 'Replace every non-finite timestamp or price, then retry the same drawing.',
      },
      details: { invalidPointIndexes },
    });
  }

  const pointCountValid = expectedPointCount === null
    ? points.length > 0
    : points.length === expectedPointCount;
  if (!pointCountValid) {
    const expectation = expectedPointCount === null
      ? 'at least 1 anchor'
      : `${expectedPointCount} anchor${expectedPointCount === 1 ? '' : 's'}`;
    throw new ApplicationError('INVALID_ARGUMENT', `${drawingType} requires ${expectation}; received ${points.length}.`, {
      recovery: {
        action: 'change_input',
        instruction: 'Call romaco_list_templates, provide the required anchor count, then retry.',
        parameters: {
          drawingType,
          expectedPointCount,
          actualPointCount: points.length,
        },
      },
      details: {
        drawingType,
        expectedPointCount,
        actualPointCount: points.length,
      },
    });
  }
}

export class AddDrawingUseCase {
  constructor(
    private readonly chart: ChartPort,
    private readonly templates: DrawingTemplateCatalogPort,
    private readonly journal: ChartDrawingJournalPort,
  ) {}

  async execute(input: AddDrawingInput): Promise<AddDrawingResult> {
    const requestedType = input.drawingType.trim();
    const template = this.templates.findByName(requestedType);
    if (!template) {
      throw new ApplicationError('INVALID_ARGUMENT', `Unknown drawing template: ${requestedType || '(empty)'}.`, {
        recovery: {
          action: 'change_input',
          instruction: 'Call romaco_list_templates and retry with one returned template name.',
        },
        details: { drawingType: requestedType },
      });
    }
    // Validate all host-owned template invariants before reading identity or writing.
    validatePoints(template.name, input.points, template.pointCount);

    const identity = await this.chart.getIdentity();
    if (!identity.symbol || !identity.timeframe) {
      throw new ApplicationError('CHART_NOT_READY', 'Live chart identity requires chartId, symbol, and timeframe.', {
        retryable: true,
        recovery: { action: 'connect_chart', instruction: 'Load a symbol and timeframe in McpBridge, then retry.' },
      });
    }
    const drawing: AddDrawingCommand = {
      action: 'addDrawing',
      drawingType: template.name,
      points: input.points,
      ...(input.label !== undefined ? { label: input.label } : {}),
      ...(input.style !== undefined ? { style: input.style } : {}),
      ...(input.paneId !== undefined ? { paneId: input.paneId } : {}),
      ...(input.groupId !== undefined ? { groupId: input.groupId } : {}),
    };
    const result = await this.chart.execute(drawing, { expectedIdentity: identity });
    if (!result.success) {
      throw new ApplicationError('ACTION_DENIED', result.error ?? 'Chart rejected drawing.', {
        recovery: { action: 'retry', instruction: 'Refresh matching chart state before deciding whether to retry.' },
      });
    }
    const drawingId = result.resourceIds?.[0];
    this.journal.recordDrawing(drawing, identity, drawingId);
    return {
      drawing,
      ...(drawingId ? { drawingId } : {}),
      chartIdentity: identity,
    };
  }
}
