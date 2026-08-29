import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { ApplicationError } from '../../../../application/errors.js';
import type { ChartPort } from '../../../../application/ports/chart.js';
import type { ChartJournalPort } from '../../../../application/ports/chartJournal.js';
import { registerCatalogContractTool } from '../catalogContractTool.js';
import type { RegisterContractToolOptions, ToolWarning } from '../contracts.js';
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
        'Add one technical indicator to the connected chart and return the exact host indicatorId when supported. ' +
        'A legacy host without stable IDs returns applied:true plus a partial warning; desired state remains journaled.',
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
        if (!result.success) {
          throw new ApplicationError('ACTION_DENIED', result.error ?? 'Chart rejected indicator write.', {
            recovery: { action: 'retry', instruction: 'Refresh chart state before retrying the indicator write.' },
          });
        }
        const indicator = { type: indicatorType.toUpperCase(), params: params ?? [] };
        const indicatorId = result.resourceIds?.[0] ?? null;
        // Host write already succeeded. Record desired state even when an older
        // host cannot return its resource ID; reporting an error would invite a
        // duplicate retry and make reconnect lose the applied indicator.
        journal.recordIndicator(indicator, identity, indicatorId ?? undefined);
        const warnings: ToolWarning[] = indicatorId
          ? []
          : [{
              code: 'RESOURCE_ID_UNAVAILABLE',
              message:
                'Chart applied indicator without a stable indicatorId. Refresh context for name-based follow-up or upgrade romaco-charts.',
            }];
        return {
          status: warnings.length ? 'partial' : 'ok',
          data: {
            indicator: { indicatorId, ...indicator },
            applied: true as const,
          },
          summary: indicatorId
            ? `${indicator.type}(${indicator.params.join(', ')}) added as ${indicatorId}.`
            : `${indicator.type}(${indicator.params.join(', ')}) added; host returned no stable indicatorId.`,
          context: {
            chartId: identity.chartId,
            symbol: identity.symbol,
            timeframe: identity.timeframe,
            datasetId: identity.datasetId,
          },
          warnings,
        };
      } catch (error) {
        throw chartError(error);
      }
    },
    options,
  );
}
