import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { enrichBridgeResult } from './_guards.js';
import type { ChartPort } from '../application/ports/chart.js';
import type { ChartDesiredStatePort } from '../application/ports/chartDesiredState.js';

export function registerAddAlert(
  server: McpServer,
  chart: ChartPort,
  desiredState: ChartDesiredStatePort,
): void {
  server.registerTool(
    'romaco_add_alert',
    {
      description:
        'Add a price alert on the chart. Triggered alerts are shown visually. Use romaco_get_chart_context to see existing alerts.',
      inputSchema: {
        price: z.number().describe('Price level to trigger the alert at'),
        direction: z
          .enum(['above', 'below', 'cross'])
          .optional()
          .describe(
            '"above" = triggers when price rises above. "below" = falls below. "cross" = either direction (default).'
          ),
        note: z
          .string()
          .optional()
          .describe('Optional note attached to the alert, e.g. "Key resistance level"'),
      },
    },
    async ({ price, direction, note }) => {
      let identity;
      try {
        identity = await chart.getIdentity();
      } catch (error) {
        return {
          content: [{ type: 'text' as const, text: `romaco_add_alert: ${error instanceof Error ? error.message : String(error)}` }],
          isError: true,
        };
      }
      let result;
      try {
        result = await chart.execute(
          { action: 'addAlert', price, options: { direction, note } },
          { expectedIdentity: identity },
        );
      } catch (error) {
        return {
          content: [{ type: 'text' as const, text: `romaco_add_alert: ${error instanceof Error ? error.message : String(error)}` }],
          isError: true,
        };
      }
      if (result.success) {
        desiredState.recordAlert(
          { action: 'addAlert', price, options: { direction, note } },
          identity,
          result.resourceIds?.[0],
        );
        return {
          content: [
            {
              type: 'text' as const,
              text: `Alert set at ${price}${direction ? ` (${direction})` : ''}${note ? ` — "${note}"` : ''}`,
            },
          ],
        };
      }
      const { text, isError } = enrichBridgeResult('romaco_add_alert', result);
      return { content: [{ type: 'text' as const, text }], isError };
    }
  );
}
