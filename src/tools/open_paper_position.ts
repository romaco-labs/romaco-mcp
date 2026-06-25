import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { bridge } from '../bridge.js';
import { enrichBridgeResult } from './_guards.js';

export function registerOpenPaperPosition(server: McpServer): void {
  server.registerTool(
    'romaco_open_paper_position',
    {
      description:
        'Open a simulated (paper) trading position at the current market price. No real money involved. Positions are shown visually on the chart as entry markers.',
      inputSchema: {
        side: z.enum(['long', 'short']).describe(
          '"long" = buy (profit when price rises). "short" = sell (profit when price falls).'
        ),
        quantity: z.number().positive().describe('Number of units to trade (shares, contracts, coins)'),
        stopLoss: z
          .number()
          .optional()
          .describe('Stop-loss price. Position auto-closes if price reaches this level.'),
        takeProfit: z
          .number()
          .optional()
          .describe('Take-profit price. Position auto-closes if price reaches this level.'),
      },
    },
    async ({ side, quantity, stopLoss, takeProfit }) => {
      const action =
        side === 'long'
          ? ({ action: 'openPaperLong', quantity, stopLoss, takeProfit } as const)
          : ({ action: 'openPaperShort', quantity, stopLoss, takeProfit } as const);
      const result = await bridge.executeAction(action);
      if (result.success) {
        return {
          content: [
            {
              type: 'text' as const,
              text: `Paper ${side} opened: ${quantity} units${stopLoss ? ` | SL: ${stopLoss}` : ''}${takeProfit ? ` | TP: ${takeProfit}` : ''}`,
            },
          ],
        };
      }
      const { text, isError } = enrichBridgeResult('romaco_open_paper_position', result);
      return { content: [{ type: 'text' as const, text }], isError };
    }
  );
}
