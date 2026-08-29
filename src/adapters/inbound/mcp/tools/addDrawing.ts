import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { ApplicationError } from '../../../../application/errors.js';
import type { AddDrawingUseCase } from '../../../../application/use-cases/addDrawing.js';
import { registerCatalogContractTool } from '../catalogContractTool.js';
import type { RegisterContractToolOptions, ToolWarning } from '../contracts.js';
import { addDrawingDataSchema } from '../outputSchemas.js';

function mapChartError(error: unknown): ApplicationError {
  if (error instanceof ApplicationError) return error;
  const message = error instanceof Error ? error.message : String(error);
  if (/identity mismatch|symbol mismatch|timeframe mismatch/i.test(message)) {
    return new ApplicationError('CHART_CONTEXT_MISMATCH', message, {
      recovery: {
        action: 'match_chart_identity',
        instruction: 'Refresh chart identity and retry against the intended symbol and timeframe.',
      },
      cause: error,
    });
  }
  if (/no chart|not connected|wait for mcpbridge|chart identity/i.test(message)) {
    return new ApplicationError('CHART_NOT_CONNECTED', message, {
      retryable: true,
      recovery: { action: 'connect_chart', instruction: 'Connect a ready McpBridge chart and retry.' },
      cause: error,
    });
  }
  return new ApplicationError('ACTION_DENIED', message, {
    recovery: {
      action: 'retry',
      instruction: 'Refresh matching chart state before deciding whether to retry.',
    },
    cause: error,
  });
}

export function registerAddDrawing(
  server: McpServer,
  useCase: AddDrawingUseCase,
  options: RegisterContractToolOptions = {},
): void {
  registerCatalogContractTool(
    server,
    'romaco_add_drawing',
    {
      description:
        'Validate and draw one chart template against exact live chart identity. ' +
        'Call romaco_list_templates for canonical names and required anchor counts. ' +
        'Unknown templates, wrong anchor counts, and non-finite points fail before any chart write. ' +
        'Drawings always use reserved agent ownership; omitted groupId defaults to romaco-mcp/manual. ' +
        'Successful structured output includes host drawingId when supported.',
      inputSchema: z.object({
        drawingType: z.string().min(1).describe('Canonical template name from romaco_list_templates.'),
        points: z.array(z.object({
          timestamp: z.number().describe('Finite anchor timestamp in milliseconds.'),
          price: z.number().describe('Finite anchor price or pane-axis value.'),
        }).strict()).describe('Exact template anchors. Count is validated before chart write.'),
        label: z.string().optional().describe('Optional text label rendered with the drawing.'),
        style: z.object({
          color: z.string().optional(),
          lineWidth: z.number().optional(),
          lineStyle: z.enum(['solid', 'dashed', 'dotted']).optional(),
          opacity: z.number().min(0).max(1).optional(),
          fillColor: z.string().optional(),
        }).strict().optional(),
        paneId: z.string().optional().describe('Main or indicator pane id from romaco_list_panes.'),
        groupId: z.string().optional().describe(
          'Agent-owned group in reserved romaco-mcp/<name> namespace. Omit for romaco-mcp/manual.',
        ),
      }),
      dataSchema: addDrawingDataSchema,
    },
    async (input) => {
      try {
        const result = await useCase.execute(input);
        const drawingId = result.drawingId ?? null;
        const warnings: ToolWarning[] = drawingId
          ? []
          : [{
              code: 'RESOURCE_ID_UNAVAILABLE',
              message: 'Chart applied drawing but did not return a stable drawingId; upgrade romaco-charts for exact follow-up operations.',
            }];
        const where = result.drawing.paneId && result.drawing.paneId !== 'main'
          ? ` in pane "${result.drawing.paneId}"`
          : '';
        return {
          status: warnings.length ? 'partial' : 'ok',
          data: {
            drawingId,
            applied: true as const,
            drawing: {
              id: drawingId,
              type: result.drawing.drawingType,
              pointCount: result.drawing.points.length,
              ...(result.drawing.paneId ? { paneId: result.drawing.paneId } : {}),
              ...(result.drawing.groupId ? { groupId: result.drawing.groupId } : {}),
            },
            identity: {
              chartId: result.chartIdentity.chartId,
              ...(result.chartIdentity.symbol ? { symbol: result.chartIdentity.symbol } : {}),
              ...(result.chartIdentity.timeframe ? { timeframe: result.chartIdentity.timeframe } : {}),
              ...(result.chartIdentity.datasetId ? { datasetId: result.chartIdentity.datasetId } : {}),
            },
          },
          // Preserve legacy compatibility text for clients that ignore structuredContent.
          summary: `${result.drawing.drawingType}${where} drawn on chart`,
          context: {
            chartId: result.chartIdentity.chartId,
            symbol: result.chartIdentity.symbol,
            timeframe: result.chartIdentity.timeframe,
            datasetId: result.chartIdentity.datasetId,
          },
          warnings,
        };
      } catch (error) {
        throw mapChartError(error);
      }
    },
    options,
  );
}
