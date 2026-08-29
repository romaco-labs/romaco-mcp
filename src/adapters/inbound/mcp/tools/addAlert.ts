import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { ApplicationError } from '../../../../application/errors.js';
import type { ChartPort } from '../../../../application/ports/chart.js';
import type { ChartDesiredStatePort } from '../../../../application/ports/chartDesiredState.js';
import { registerCatalogContractTool } from '../catalogContractTool.js';
import type { RegisterContractToolOptions } from '../contracts.js';
import { addAlertDataSchema } from '../outputSchemas.js';

function mapChartError(error: unknown): ApplicationError {
  if (error instanceof ApplicationError) return error;
  const message = error instanceof Error ? error.message : String(error);
  const disconnected = /no chart|not connected|disconnected|mcpbridge|identity announced/i.test(message);
  return new ApplicationError(disconnected ? 'CHART_NOT_CONNECTED' : 'ACTION_DENIED', message, {
    retryable: disconnected,
    recovery: disconnected
      ? { action: 'connect_chart', instruction: 'Connect a ready chart and retry.' }
      : { action: 'retry', instruction: 'Refresh exact chart identity before retrying.' },
    cause: error,
  });
}

export function registerAddAlert(
  server: McpServer,
  chart: ChartPort,
  desiredState: ChartDesiredStatePort,
  options: RegisterContractToolOptions = {},
): void {
  registerCatalogContractTool(
    server,
    'romaco_add_alert',
    {
      description: 'Add one price alert to the exact live chart and return its stable host alertId.',
      inputSchema: z.object({
        price: z.number().finite(),
        direction: z.enum(['above', 'below', 'cross']).optional(),
        note: z.string().optional(),
      }),
      dataSchema: addAlertDataSchema,
    },
    async ({ price, direction = 'cross', note }) => {
      try {
        const identity = await chart.getIdentity();
        if (!identity.symbol || !identity.timeframe) {
          throw new ApplicationError('CHART_NOT_READY', 'Alert requires exact chart symbol and timeframe.', {
            retryable: true,
            recovery: { action: 'connect_chart', instruction: 'Load chart symbol/timeframe and retry.' },
          });
        }
        const command = {
          action: 'addAlert' as const,
          price,
          options: { direction, ...(note === undefined ? {} : { note }) },
        };
        const result = await chart.execute(command, { expectedIdentity: identity });
        if (!result.success) throw new Error(result.error ?? 'Chart rejected alert.');
        const alertId = result.resourceIds?.[0];
        desiredState.recordAlert(command, identity, alertId);
        if (!alertId) {
          throw new ApplicationError('PARTIAL_APPLY', 'Chart applied alert without returning alertId.', {
            recovery: { action: 'retry', instruction: 'Refresh chart alerts before any removal attempt.' },
          });
        }
        return {
          data: {
            alert: { alertId, price, direction, ...(note === undefined ? {} : { note }) },
            applied: true as const,
          },
          summary: `Alert set at ${price} (${direction})${note ? ` — "${note}"` : ''}`,
          context: {
            chartId: identity.chartId,
            symbol: identity.symbol,
            timeframe: identity.timeframe,
            datasetId: identity.datasetId,
          },
        };
      } catch (error) {
        throw mapChartError(error);
      }
    },
    options,
  );
}
