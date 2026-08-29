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
      const context = (await bridge.getContext(false)) as {
        alerts?: Array<{
          id?: string;
          price?: number;
          direction?: 'above' | 'below' | 'cross';
        }>;
      };
      const alert = context.alerts?.find(
        (candidate) => candidate.price === price && (!direction || candidate.direction === direction),
      );
      if (!alert?.id) {
        const suffix = direction ? ` (${direction})` : '';
        return {
          content: [{ type: 'text' as const, text: `Alert at ${price}${suffix} not found.` }],
          isError: true,
        };
      }

      const result = await bridge.executeAction({
        action: 'removeAlert',
        alertId: alert.id,
      });
      if (result.success) {
        chartState.removeAlert(alert.id, price, alert.direction ?? direction ?? 'cross');
        return {
          content: [{ type: 'text' as const, text: `Alert at ${price} removed.` }],
        };
      }
      const { text, isError } = enrichBridgeResult('romaco_remove_alert', result);
      return { content: [{ type: 'text' as const, text }], isError };
    },
  );
}
