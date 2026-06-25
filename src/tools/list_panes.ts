import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { bridge } from '../bridge.js';

/**
 * Returns the panes (main + indicator subpanels) currently on the chart so AI
 * agents can target drawings at a specific pane via `paneId` on add_drawing.
 */
export function registerListPanes(server: McpServer): void {
  server.registerTool(
    'romaco_list_panes',
    {
      description:
        'List the chart panes: the main candlestick pane plus every indicator subpanel. Each pane returns its id, the indicators it hosts, and a short alias (e.g. "rsi"). Use the id as `paneId` on romaco_add_drawing to anchor a drawing inside that pane.',
      inputSchema: {},
    },
    async () => {
      const result = await bridge.executeAction({ action: 'listPanes' });
      const text = result.success
        ? JSON.stringify(result.data, null, 2)
        : `Failed to list panes: ${result.error}`;
      return { content: [{ type: 'text' as const, text }] };
    },
  );
}
