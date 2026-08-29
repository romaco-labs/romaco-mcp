import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { ApplicationError } from '../../../../application/errors.js';
import type { ChartPort } from '../../../../application/ports/chart.js';
import type { ChartDesiredStatePort } from '../../../../application/ports/chartDesiredState.js';
import { registerCatalogContractTool } from '../catalogContractTool.js';
import type { RegisterContractToolOptions } from '../contracts.js';
import { removeAlertDataSchema } from '../outputSchemas.js';

export function registerRemoveAlert(
  server: McpServer,
  chart: ChartPort,
  desiredState: ChartDesiredStatePort,
  options: RegisterContractToolOptions = {},
): void {
  registerCatalogContractTool(
    server,
    'romaco_remove_alert',
    {
      description: 'Remove one chart alert by exact host alertId; price/direction lookup remains a compatibility fallback.',
      inputSchema: z.object({
        alertId: z.string().min(1).optional(),
        price: z.number().finite().optional(),
        direction: z.enum(['above', 'below', 'cross']).optional(),
      }),
      dataSchema: removeAlertDataSchema,
    },
    async ({ alertId, price, direction }) => {
      if (!alertId && price === undefined) {
        throw new ApplicationError('INVALID_ARGUMENT', 'Provide alertId or price.', {
          recovery: { action: 'change_input', instruction: 'Use alertId returned by romaco_add_alert.' },
        });
      }
      try {
        const context = await chart.getContext({ includeCandles: false });
        const alert = context.alerts?.find((candidate) =>
          alertId
            ? candidate.id === alertId
            : candidate.price === price && (!direction || candidate.direction === direction),
        );
        if (!alert?.id) {
          throw new ApplicationError('NOT_FOUND', 'Alert not found on current chart.', {
            recovery: { action: 'retry', instruction: 'Refresh chart context and use a current alertId.' },
          });
        }
        const result = await chart.execute(
          { action: 'removeAlert', alertId: alert.id },
          { expectedIdentity: context.identity },
        );
        if (!result.success) throw new Error(result.error ?? 'Chart rejected alert removal.');
        const removed = (result.data as { removed?: unknown } | undefined)?.removed !== false;
        if (removed) desiredState.removeAlert(alert.id, alert.price, alert.direction);
        return {
          status: removed ? 'ok' as const : 'noop' as const,
          data: {
            alertId: alert.id,
            price: alert.price,
            direction: alert.direction,
            removed,
          },
          summary: removed ? `Alert at ${alert.price} removed.` : `Alert at ${alert.price} already absent.`,
          context: {
            chartId: context.identity.chartId,
            symbol: context.identity.symbol,
            timeframe: context.identity.timeframe,
            datasetId: context.identity.datasetId,
          },
        };
      } catch (error) {
        if (error instanceof ApplicationError) throw error;
        const message = error instanceof Error ? error.message : String(error);
        const disconnected = /no chart|not connected|disconnected|mcpbridge/i.test(message);
        throw new ApplicationError(disconnected ? 'CHART_NOT_CONNECTED' : 'ACTION_DENIED', message, {
          retryable: disconnected,
          recovery: disconnected
            ? { action: 'connect_chart', instruction: 'Connect a ready chart and retry.' }
            : { action: 'retry', instruction: 'Refresh chart state before retrying removal.' },
          cause: error,
        });
      }
    },
    options,
  );
}
