import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { ApplicationError } from '../../../../application/errors.js';
import type { ChartPort } from '../../../../application/ports/chart.js';
import { compressIndicatorValues } from '../../../../compression/snapshot.js';
import { registerCatalogContractTool } from '../catalogContractTool.js';
import type { RegisterContractToolOptions } from '../contracts.js';
import { indicatorValuesDataSchema } from '../outputSchemas.js';

export function registerGetIndicatorValues(
  server: McpServer,
  chart: ChartPort,
  options: RegisterContractToolOptions = {},
): void {
  registerCatalogContractTool(
    server,
    'romaco_get_indicator_values',
    {
      description:
        'Read one chart indicator by exact indicatorId (preferred) or display name. ' +
        'Default output is compressed. Set acknowledgeHighTokenCost:true only for explicit all-bar requests.',
      inputSchema: z.object({
        indicatorId: z.string().min(1).optional(),
        indicatorName: z.string().min(1).optional(),
        acknowledgeHighTokenCost: z.literal(true).optional(),
      }),
      dataSchema: indicatorValuesDataSchema,
    },
    async ({ indicatorId, indicatorName, acknowledgeHighTokenCost }) => {
      if (!indicatorId && !indicatorName) {
        throw new ApplicationError('INVALID_ARGUMENT', 'Provide indicatorId or indicatorName.', {
          recovery: { action: 'change_input', instruction: 'Use the indicatorId returned by romaco_add_indicator.' },
        });
      }
      try {
        const identity = await chart.getIdentity();
        const result = await chart.execute(
          { action: 'getIndicatorValues', indicatorId, indicatorName },
          { expectedIdentity: identity },
        );
        const raw = result.data;
        const payload = acknowledgeHighTokenCost === true ? raw : compressIndicatorValues(raw);
        const returnedId = (raw as { id?: unknown; indicatorId?: unknown } | undefined)?.id
          ?? (raw as { indicatorId?: unknown } | undefined)?.indicatorId
          ?? indicatorId;
        if (typeof returnedId !== 'string' || !returnedId) {
          throw new ApplicationError('NOT_FOUND', 'Chart did not return an indicator identity.', {
            recovery: { action: 'retry', instruction: 'List panes or add the indicator again, then use its exact ID.' },
          });
        }
        if (indicatorId && returnedId !== indicatorId) {
          throw new ApplicationError('CHART_CONTEXT_MISMATCH', 'Chart returned a different indicator identity.', {
            recovery: { action: 'retry', instruction: 'Refresh chart state and retry with the current indicatorId.' },
          });
        }
        if (typeof payload !== 'object' || payload === null || Array.isArray(payload)) {
          throw new ApplicationError('INTERNAL', 'Chart returned invalid indicator values.');
        }
        return {
          data: {
            format: acknowledgeHighTokenCost === true ? 'full' as const : 'concise' as const,
            indicatorId: returnedId,
            values: payload as Record<string, unknown>,
          },
          summary: JSON.stringify(payload, null, 2),
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
        const disconnected = /no chart|not connected|disconnected|wait for mcpbridge/i.test(message);
        throw new ApplicationError(disconnected ? 'CHART_NOT_CONNECTED' : 'ACTION_DENIED', message, {
          retryable: disconnected,
          recovery: disconnected
            ? { action: 'connect_chart', instruction: 'Connect a ready chart and retry.' }
            : { action: 'retry', instruction: 'Refresh chart state and retry the indicator read.' },
          cause: error,
        });
      }
    },
    options,
  );
}
