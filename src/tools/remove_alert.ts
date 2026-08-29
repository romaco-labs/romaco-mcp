import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { enrichBridgeResult } from './_guards.js';
import type { ChartPort } from '../application/ports/chart.js';
import type { ChartDesiredStatePort } from '../application/ports/chartDesiredState.js';

export function registerRemoveAlert(
  server: McpServer,
  chart: ChartPort,
  desiredState: ChartDesiredStatePort,
): void {
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
      const context = await chart.getContext({ includeCandles: false });
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

      let result;
      try {
        result = await chart.execute(
          { action: 'removeAlert', alertId: alert.id },
          { expectedIdentity: context.identity },
        );
      } catch (error) {
        return {
          content: [{ type: 'text' as const, text: `romaco_remove_alert: ${error instanceof Error ? error.message : String(error)}` }],
          isError: true,
        };
      }
      if (result.success) {
        desiredState.removeAlert(alert.id, price, alert.direction ?? direction ?? 'cross');
        return {
          content: [{ type: 'text' as const, text: `Alert at ${price} removed.` }],
        };
      }
      const { text, isError } = enrichBridgeResult('romaco_remove_alert', result);
      return { content: [{ type: 'text' as const, text }], isError };
    },
  );
}
