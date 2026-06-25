import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { bridge } from '../bridge.js';
import { compressChartContext } from '../compression/snapshot.js';

export function registerGetChartContext(server: McpServer): void {
  server.registerTool(
    'romaco_get_chart_context',
    {
      description:
        'Get a compressed snapshot of the romaco chart state: last price, pane list, indicator/drawing/alert counts, visible range, zoom, render backend. ' +
        'Cost: compressed by default (~1 KB). Set acknowledgeHighTokenCost:true to receive the raw chart context (≈80 KB including all visible candles, every drawing with its points, full indicator params, and capability registries). ' +
        'Only opt in to the raw payload when the user has explicitly asked for it.',
      inputSchema: {
        acknowledgeHighTokenCost: z
          .literal(true)
          .optional()
          .describe(
            'WARNING: setting this true returns ~80 KB of raw chart state. ' +
            'Only opt in when the USER has explicitly asked for full chart state and accepts the token cost. ' +
            'Default (omit) returns a compressed feature summary.',
          ),
      },
    },
    async ({ acknowledgeHighTokenCost }) => {
      const context = await bridge.getContext(acknowledgeHighTokenCost === true);
      const payload =
        acknowledgeHighTokenCost === true ? context : compressChartContext(context);
      return {
        content: [{ type: 'text' as const, text: JSON.stringify(payload, null, 2) }],
      };
    },
  );
}
