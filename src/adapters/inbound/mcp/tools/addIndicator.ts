import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { ApplicationError } from '../../../../application/errors.js';
import type { ChartPort } from '../../../../application/ports/chart.js';
import type { ChartJournalPort } from '../../../../application/ports/chartJournal.js';
import { registerCatalogContractTool } from '../catalogContractTool.js';
import type { RegisterContractToolOptions } from '../contracts.js';
import { addIndicatorDataSchema } from '../outputSchemas.js';

function chartError(error: unknown): ApplicationError {
  if (error instanceof ApplicationError) return error;
  const message = error instanceof Error ? error.message : String(error);
  const disconnected = /no chart|not connected|disconnected|wait for mcpbridge/i.test(message);
  return new ApplicationError(disconnected ? 'CHART_NOT_CONNECTED' : 'ACTION_DENIED', message, {
    retryable: disconnected,
    recovery: disconnected
      ? { action: 'connect_chart', instruction: 'Connect a ready chart with McpBridge and retry.' }
      : { action: 'retry', instruction: 'Refresh chart state and retry the indicator write.' },
    cause: error,
  });
}

export function registerAddIndicator(
  server: McpServer,
  chart: ChartPort,
  journal: ChartJournalPort,
  options: RegisterContractToolOptions = {},
): void {
  registerCatalogContractTool(
    server,
    'romaco_add_indicator',
    {
      description:
        'Add one technical indicator to the connected chart and return the exact host indicatorId. ' +
        'Use that ID for follow-up reads and removals.',
      inputSchema: z.object({
        indicatorType: z.string().min(1),
        params: z.array(z.number()).optional(),
      }),
      dataSchema: addIndicatorDataSchema,
    },
    async ({ indicatorType, params }) => {
      try {
        const identity = await chart.getIdentity();
        const result = await chart.execute(
          { action: 'addIndicator', indicatorType, params },
          { expectedIdentity: identity },
        );
        const indicatorId = result.resourceIds?.[0];
        if (!indicatorId) {
          throw new ApplicationError('PARTIAL_APPLY', 'Chart applied indicator without returning indicatorId.', {
            recovery: {
              action: 'retry',
              instruction: 'Refresh chart context before any ID-based follow-up.',
            },
          });
        }
        const indicator = { type: indicatorType.toUpperCase(), params: params ?? [] };
        journal.recordIndicator(indicator, identity, indicatorId);
        return {
          data: {
            indicator: { indicatorId, ...indicator },
            applied: true as const,
          },
          summary: `${indicator.type}(${indicator.params.join(', ')}) added as ${indicatorId}.`,
          context: {
            chartId: identity.chartId,
            symbol: identity.symbol,
            timeframe: identity.timeframe,
            datasetId: identity.datasetId,
          },
        };
      } catch (error) {
        throw chartError(error);
      }
    },
    options,
  );
}
