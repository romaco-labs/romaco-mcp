import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { ApplicationError } from '../../../../application/errors.js';
import type { ChartPort } from '../../../../application/ports/chart.js';
import { compressChartContext } from '../../../../compression/snapshot.js';
import { registerCatalogContractTool } from '../catalogContractTool.js';
import type { RegisterContractToolOptions } from '../contracts.js';
import { chartContextDataSchema } from '../outputSchemas.js';

export function registerGetChartContext(
  server: McpServer,
  chart: ChartPort,
  options: RegisterContractToolOptions = {},
): void {
  registerCatalogContractTool(
    server,
    'romaco_get_chart_context',
    {
      description:
        'Get canonical chart identity and a compressed live-state snapshot without exporting candle arrays.',
      inputSchema: z.object({
        acknowledgeHighTokenCost: z.literal(true).optional().describe(
          'Raw chart-state export is disabled; this flag returns an explicit authorization error.',
        ),
      }),
      dataSchema: chartContextDataSchema,
    },
    async ({ acknowledgeHighTokenCost }) => {
      if (acknowledgeHighTokenCost === true) {
        throw new ApplicationError(
          'ACTION_DENIED',
          'Raw chart-state export requires an explicitly authorized host integration and is disabled.',
          {
            recovery: {
              action: 'contact_support',
              instruction: 'Use concise chart context or configure a future authorized host integration.',
            },
          },
        );
      }
      try {
        const context = await chart.getContext({ includeCandles: false });
        const compressed = compressChartContext(context);
        return {
          data: {
            format: 'concise' as const,
            chartId: context.identity.chartId,
            identity: context.identity,
            context: compressed,
          },
          // Preserve legacy text as the compressed snapshot only.
          summary: JSON.stringify(compressed, null, 2),
          context: {
            chartId: context.identity.chartId,
            symbol: context.identity.symbol,
            timeframe: context.identity.timeframe,
            datasetId: context.identity.datasetId,
          },
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        const disconnected = /no chart|not connected|wait for mcpbridge/i.test(message);
        throw new ApplicationError(
          disconnected ? 'CHART_NOT_CONNECTED' : 'CHART_NOT_READY',
          `romaco_get_chart_context: ${message}`,
          {
            retryable: true,
            recovery: {
              action: 'connect_chart',
              instruction: 'Connect a chart with McpBridge and retry.',
            },
            cause: error,
          },
        );
      }
    },
    options,
  );
}
