import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { bridge } from '../bridge.js';
import { enrichBridgeResult } from './_guards.js';
import { chartState } from '../chartState.js';

export function registerRemoveIndicator(server: McpServer): void {
  server.registerTool(
    'romaco_remove_indicator',
    {
      description: 'Remove a technical indicator from the chart by type. Use romaco_get_chart_context to see active indicators.',
      inputSchema: {
        indicatorType: z.string().describe(
          'Indicator type to remove (e.g. EMA, RSI, MACD). Case-insensitive. Removes the first matching indicator if multiple exist.',
        ),
      },
    },
    async ({ indicatorType }) => {
      const result = await bridge.executeAction({ action: 'removeIndicator', indicatorType });
      if (result.success) {
        chartState.removeIndicator(indicatorType);
        return {
          content: [{ type: 'text' as const, text: `Indicator ${indicatorType} removed.` }],
        };
      }
      const { text, isError } = enrichBridgeResult('romaco_remove_indicator', result);
      return { content: [{ type: 'text' as const, text }], isError };
    },
  );
}
