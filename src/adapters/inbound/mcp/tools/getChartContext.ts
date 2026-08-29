import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { ChartPort } from '../../../../application/ports/chart.js';
import { compressChartContext } from '../../../../compression/snapshot.js';

export function registerGetChartContext(server: McpServer, chart: ChartPort): void {
  server.registerTool(
    'romaco_get_chart_context',
    {
      description:
        'Get canonical chart identity and a compressed live-state snapshot without exporting candle arrays.',
      inputSchema: {
        acknowledgeHighTokenCost: z.literal(true).optional().describe(
          'Raw chart-state export is disabled in this runtime; this flag returns an explicit error.',
        ),
      },
    },
    async ({ acknowledgeHighTokenCost }) => {
      if (acknowledgeHighTokenCost === true) {
        return {
          content: [{
            type: 'text' as const,
            text: 'Raw chart-state export requires an explicitly authorized host integration and is disabled.',
          }],
          isError: true,
        };
      }
      try {
        const context = await chart.getContext({ includeCandles: false });
        return {
          content: [{
            type: 'text' as const,
            text: JSON.stringify(compressChartContext(context), null, 2),
          }],
        };
      } catch (error) {
        return {
          content: [{ type: 'text' as const, text: `romaco_get_chart_context: ${error instanceof Error ? error.message : String(error)}` }],
          isError: true,
        };
      }
    },
  );
}
