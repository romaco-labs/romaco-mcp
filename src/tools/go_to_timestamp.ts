import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { bridge } from '../bridge.js';
import { enrichBridgeResult } from './_guards.js';

export function registerGoToTimestamp(server: McpServer): void {
  server.registerTool(
    'romaco_go_to_timestamp',
    {
      description:
        'Move the chart viewport (or replay cursor if in replay mode) to a specific timestamp. Use this to revisit historical setups or scrub through past patterns. Timestamp is in milliseconds.',
      inputSchema: {
        timestamp: z.number().describe('Target timestamp in milliseconds.'),
      },
    },
    async ({ timestamp }) => {
      const result = await bridge.executeAction({ action: 'goToTimestamp', timestamp });
      if (result.success) {
        return {
          content: [
            {
              type: 'text' as const,
              text: `Chart moved to timestamp ${timestamp} (${JSON.stringify(result.data)})`,
            },
          ],
        };
      }
      const { text, isError } = enrichBridgeResult('romaco_go_to_timestamp', result);
      return { content: [{ type: 'text' as const, text }], isError };
    },
  );
}
