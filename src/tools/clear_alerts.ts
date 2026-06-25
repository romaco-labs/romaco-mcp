import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { bridge } from '../bridge.js';
import { enrichBridgeResult } from './_guards.js';
import { chartState } from '../chartState.js';

export function registerClearAlerts(server: McpServer): void {
  server.registerTool(
    'romaco_clear_alerts',
    {
      description: 'Remove all price alerts from the chart.',
      inputSchema: {},
    },
    async () => {
      const result = await bridge.executeAction({ action: 'clearAlerts' });
      if (result.success) {
        chartState.clearAlerts();
        return {
          content: [{ type: 'text' as const, text: 'All alerts cleared.' }],
        };
      }
      const { text, isError } = enrichBridgeResult('romaco_clear_alerts', result);
      return { content: [{ type: 'text' as const, text }], isError };
    },
  );
}
