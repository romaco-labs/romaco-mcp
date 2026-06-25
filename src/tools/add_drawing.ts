import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { bridge } from '../bridge.js';
import { enrichBridgeResult } from './_guards.js';
import { listDrawingTypeNames } from '../data/templateCatalog.js';
import { chartState } from '../chartState.js';
import { session } from '../session.js';

export function registerAddDrawing(server: McpServer): void {
  const drawingTypes = listDrawingTypeNames();
  const typeList = drawingTypes.join(', ');
  const templateCount = drawingTypes.length;

  server.registerTool(
    'romaco_add_drawing',
    {
      description:
        `Draw a technical-analysis shape on the chart. Romaco-charts ships ${templateCount} templates: ` +
        typeList +
        '. Required point counts vary per template (use romaco_list_templates ' +
        'to discover them). `style`, `paneId`, and `groupId` are optional. ' +
        'Use romaco_get_visible_candles to fetch real timestamps and prices ' +
        'for the anchor points. To draw inside an indicator subpanel (e.g. a ' +
        'horizontal line at RSI=70 inside the RSI pane), pass `paneId` from ' +
        'romaco_list_panes.',
      inputSchema: {
        drawingType: z
          .string()
          .describe('Template name. Run romaco_list_templates for the full catalog.'),
        points: z
          .array(
            z.object({
              timestamp: z
                .number()
                .describe('Anchor timestamp in milliseconds.'),
              price: z.number().describe('Anchor price (value-axis units).'),
            }),
          )
          .describe(
            'Anchor points. Single-point templates (horizontalLine, text, priceAlert) need 1; trendline / fib / rectangle need 2; parallelChannel / elliottWave3 need 3; etc.',
          ),
        label: z.string().optional().describe('Optional text label rendered with the drawing.'),
        style: z
          .object({
            color: z.string().optional().describe('Stroke color (CSS hex or rgba).'),
            lineWidth: z.number().optional(),
            lineStyle: z.enum(['solid', 'dashed', 'dotted']).optional(),
            opacity: z.number().min(0).max(1).optional(),
            fillColor: z.string().optional(),
          })
          .optional()
          .describe(
            'Optional styling. Flat shape; mapped server-side to the chart’s nested DrawingStyle.',
          ),
        paneId: z
          .string()
          .optional()
          .describe(
            'Where to draw. "main" (default) for the candlestick pane, or a subpanel id from romaco_list_panes for inside-indicator drawings.',
          ),
        groupId: z
          .string()
          .optional()
          .describe('Atomic group id — drawings sharing this id are added/removed together.'),
      },
    },
    async ({ drawingType, points, label, style, paneId, groupId }) => {
      const result = await bridge.executeAction({
        action: 'addDrawing',
        drawingType,
        points,
        label,
        style,
        paneId,
        groupId,
      });
      if (result.success) {
        chartState.recordDrawing(
          { action: 'addDrawing', drawingType, points, label, style, paneId, groupId },
          session.getLastLoad()?.symbol ?? null,
        );
        const where = paneId && paneId !== 'main' ? ` in pane "${paneId}"` : '';
        return { content: [{ type: 'text' as const, text: `${drawingType}${where} drawn on chart` }] };
      }
      const { text, isError } = enrichBridgeResult('romaco_add_drawing', result);
      return { content: [{ type: 'text' as const, text }], isError };
    },
  );
}
