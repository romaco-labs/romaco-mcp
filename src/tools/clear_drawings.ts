import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { bridge } from '../bridge.js';
import { enrichBridgeResult } from './_guards.js';
import { chartState } from '../chartState.js';

export function registerClearDrawings(server: McpServer): void {
  server.registerTool(
    'romaco_clear_drawings',
    {
      description:
        'Remove all drawings from the chart (trendlines, Fibonacci retracements, horizontal lines, rectangles, channels, annotations). Cannot be undone.',
    },
    async () => {
      const result = await bridge.executeAction({ action: 'clearDrawings' });
      if (result.success) {
        chartState.clearDrawings();
        return { content: [{ type: 'text' as const, text: 'All drawings cleared' }] };
      }
      const { text, isError } = enrichBridgeResult('romaco_clear_drawings', result);
      return { content: [{ type: 'text' as const, text }], isError };
    }
  );
}
