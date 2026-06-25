import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { bridge } from '../bridge.js';
import { enrichBridgeResult } from './_guards.js';

export function registerSetZoom(server: McpServer): void {
  server.registerTool(
    'romaco_set_zoom',
    {
      description:
        'Zoom the chart in or out. Each call zooms by the given factor (default 1.5x). Call multiple times for more zoom. Use romaco_reset_view to return to default fit.',
      inputSchema: {
        direction: z.enum(['in', 'out']).describe(
          '"in" = fewer candles in detail, "out" = more candles visible'
        ),
        factor: z
          .number()
          .min(1.05)
          .max(5)
          .optional()
          .describe('Zoom multiplier (default 1.5). Higher = more zoom per call.'),
      },
    },
    async ({ direction, factor }) => {
      const action =
        direction === 'in'
          ? ({ action: 'zoomIn', factor } as const)
          : ({ action: 'zoomOut', factor } as const);
      const result = await bridge.executeAction(action);
      if (result.success) {
        return { content: [{ type: 'text' as const, text: `Zoomed ${direction}` }] };
      }
      const { text, isError } = enrichBridgeResult('romaco_set_zoom', result);
      return { content: [{ type: 'text' as const, text }], isError };
    }
  );

  server.registerTool(
    'romaco_reset_view',
    {
      description:
        'Reset the chart view to auto-fit all available data. Use after zooming or panning to return to the default overview.',
    },
    async () => {
      const result = await bridge.executeAction({ action: 'resetView' });
      if (result.success) {
        return { content: [{ type: 'text' as const, text: 'View reset to auto-fit' }] };
      }
      const { text, isError } = enrichBridgeResult('romaco_reset_view', result);
      return { content: [{ type: 'text' as const, text }], isError };
    }
  );
}
