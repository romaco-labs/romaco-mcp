import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { bridge } from '../bridge.js';
import { enrichBridgeResult } from './_guards.js';
import { chartState } from '../chartState.js';

export function registerRemoveAlert(server: McpServer): void {
  server.registerTool(
    'romaco_remove_alert',
    {
      description: 'Remove a specific price alert from the chart. Use romaco_get_chart_context to see existing alerts and their price/direction.',
      inputSchema: {
        price: z.number().describe('Price level of the alert to remove'),
        direction: z
          .enum(['above', 'below', 'cross'])
          .optional()
          .describe('Direction of the alert to remove (omit to match any direction at that price)'),
      },
    },
    async ({ price, direction }) => {
      const result = await bridge.executeAction({
        action: 'removeAlert',
        price,
        direction,
      });
      if (result.success) {
        chartState.removeAlert(price, direction ?? 'cross');
        return {
          content: [{ type: 'text' as const, text: `Alert at ${price} removed.` }],
        };
      }
      const { text, isError } = enrichBridgeResult('romaco_remove_alert', result);
      return { content: [{ type: 'text' as const, text }], isError };
    },
  );
}
