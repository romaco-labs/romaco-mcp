import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { ApplicationError } from '../../../../application/errors.js';
import type { ChartPort } from '../../../../application/ports/chart.js';
import type { ChartDesiredStatePort } from '../../../../application/ports/chartDesiredState.js';
import { registerCatalogContractTool } from '../catalogContractTool.js';
import type { RegisterContractToolOptions } from '../contracts.js';
import { removeIndicatorDataSchema } from '../outputSchemas.js';

export function registerRemoveIndicator(
  server: McpServer,
  chart: ChartPort,
  desiredState: ChartDesiredStatePort,
  options: RegisterContractToolOptions = {},
): void {
  registerCatalogContractTool(
    server,
    'romaco_remove_indicator',
    {
      description: 'Remove one chart indicator by exact host indicatorId; type lookup remains a compatibility fallback.',
      inputSchema: z.object({
        indicatorId: z.string().min(1).optional(),
        indicatorType: z.string().min(1).optional(),
      }),
      dataSchema: removeIndicatorDataSchema,
    },
    async ({ indicatorId, indicatorType }) => {
      if (!indicatorId && !indicatorType) {
        throw new ApplicationError('INVALID_ARGUMENT', 'Provide indicatorId or indicatorType.', {
          recovery: { action: 'change_input', instruction: 'Use indicatorId returned by romaco_add_indicator.' },
        });
      }
      try {
        const context = await chart.getContext({ includeCandles: false });
        const indicator = context.indicators?.find((candidate) =>
          indicatorId
            ? candidate.id === indicatorId
            : candidate.type.toLowerCase() === indicatorType!.toLowerCase(),
        );
        if (!indicator?.id) {
          throw new ApplicationError('NOT_FOUND', 'Indicator not found on current chart.', {
            recovery: { action: 'retry', instruction: 'Refresh chart context and use a current indicatorId.' },
          });
        }
        const result = await chart.execute(
          { action: 'removeIndicator', indicatorId: indicator.id },
          { expectedIdentity: context.identity },
        );
        if (!result.success) throw new Error(result.error ?? 'Chart rejected indicator removal.');
        const removed = (result.data as { removed?: unknown } | undefined)?.removed !== false;
        if (removed) desiredState.removeIndicator(indicator.id, indicator.type, indicator.params);
        return {
          status: removed ? 'ok' as const : 'noop' as const,
          data: {
            indicatorId: indicator.id,
            type: indicator.type,
            params: [...indicator.params],
            removed,
          },
          summary: removed ? `Indicator ${indicator.type} removed.` : `Indicator ${indicator.type} already absent.`,
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
