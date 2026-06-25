import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { bridge } from '../bridge.js';
import { enrichBridgeResult } from './_guards.js';
import { chartState } from '../chartState.js';
import { session } from '../session.js';

export function registerAddAlert(server: McpServer): void {
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
      const result = await bridge.executeAction({
        action: 'addAlert',
        price,
        options: { direction, note },
      });
      if (result.success) {
        chartState.recordAlert(
          { action: 'addAlert', price, options: { direction, note } },
          session.getLastLoad()?.symbol ?? null,
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
