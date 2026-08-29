import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { ChartPort } from '../../../../application/ports/chart.js';

export function registerListPanes(server: McpServer, chart: ChartPort): void {
  server.registerTool(
    'romaco_list_panes',
    {
      description: 'List main and indicator panes. Use returned id as paneId on romaco_add_drawing.',
      inputSchema: {},
    },
    async () => {
      try {
        const result = await chart.execute({ action: 'listPanes' });
        return { content: [{ type: 'text' as const, text: JSON.stringify(result.data, null, 2) }] };
      } catch (error) {
        return {
          content: [{ type: 'text' as const, text: `romaco_list_panes: ${error instanceof Error ? error.message : String(error)}` }],
          isError: true,
        };
      }
    },
  );
}
