import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { ApplicationError } from '../../../../application/errors.js';
import type { ChartPort } from '../../../../application/ports/chart.js';
import { registerCatalogContractTool } from '../catalogContractTool.js';
import type { RegisterContractToolOptions } from '../contracts.js';
import { listPanesDataSchema } from '../outputSchemas.js';

export function registerListPanes(
  server: McpServer,
  chart: ChartPort,
  options: RegisterContractToolOptions = {},
): void {
  registerCatalogContractTool(
    server,
    'romaco_list_panes',
    {
      description: 'List main and indicator panes. Use returned id as paneId on romaco_add_drawing.',
      inputSchema: z.object({}),
      dataSchema: listPanesDataSchema,
    },
    async () => {
      try {
        const identity = await chart.getIdentity();
        const result = await chart.execute({ action: 'listPanes' }, { expectedIdentity: identity });
        if (!result.success) throw new Error(result.error ?? 'Chart rejected listPanes.');
        const payload = result.data as { panes?: unknown } | undefined;
        if (!payload || typeof payload !== 'object' || !Array.isArray(payload.panes) || !payload.panes.every(
          (pane) => typeof pane === 'object' && pane !== null && !Array.isArray(pane),
        )) {
          throw new ApplicationError('INTERNAL', 'Chart returned an invalid pane list.');
        }
        const panes = payload.panes as Array<Record<string, unknown>>;
        return {
          data: { chartId: identity.chartId, panes },
          // Preserve ChartAgentController's legacy `{ panes }` text shape.
          summary: JSON.stringify({ panes }, null, 2),
          context: {
            chartId: identity.chartId,
            symbol: identity.symbol,
            timeframe: identity.timeframe,
            datasetId: identity.datasetId,
          },
        };
      } catch (error) {
        if (error instanceof ApplicationError) throw error;
        const message = error instanceof Error ? error.message : String(error);
        const disconnected = /no chart|not connected|wait for mcpbridge/i.test(message);
        throw new ApplicationError(
          disconnected ? 'CHART_NOT_CONNECTED' : 'ACTION_DENIED',
          `romaco_list_panes: ${message}`,
          {
            retryable: disconnected,
            recovery: disconnected
              ? { action: 'connect_chart', instruction: 'Connect a chart with McpBridge and retry.' }
              : { action: 'retry', instruction: 'Refresh chart state and retry.' },
            cause: error,
          },
        );
      }
    },
    options,
  );
}
