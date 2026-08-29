import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { enrichBridgeResult } from './_guards.js';
import type { ChartPort } from '../application/ports/chart.js';
import type { ChartDesiredStatePort } from '../application/ports/chartDesiredState.js';

export function registerRemoveIndicator(
  server: McpServer,
  chart: ChartPort,
  desiredState: ChartDesiredStatePort,
): void {
  server.registerTool(
    'romaco_remove_indicator',
    {
      description: 'Remove a technical indicator from the chart by type. Use romaco_get_chart_context to see active indicators.',
      inputSchema: {
        indicatorType: z.string().describe(
          'Indicator type to remove (e.g. EMA, RSI, MACD). Case-insensitive. Removes the first matching indicator if multiple exist.',
        ),
      },
    },
    async ({ indicatorType }) => {
      const context = await chart.getContext({ includeCandles: false });
      const indicator = context.indicators?.find(
        (candidate) => candidate.type.toLowerCase() === indicatorType.toLowerCase(),
      );
      if (!indicator?.id) {
        return {
          content: [{ type: 'text' as const, text: `Indicator ${indicatorType} not found.` }],
          isError: true,
        };
      }

      let result;
      try {
        result = await chart.execute(
          { action: 'removeIndicator', indicatorId: indicator.id },
          { expectedIdentity: context.identity },
        );
      } catch (error) {
        return {
          content: [{ type: 'text' as const, text: `romaco_remove_indicator: ${error instanceof Error ? error.message : String(error)}` }],
          isError: true,
        };
      }
      if (result.success) {
        desiredState.removeIndicator(context.identity, indicator.id, indicatorType, indicator.params);
        return {
          content: [{ type: 'text' as const, text: `Indicator ${indicatorType} removed.` }],
        };
      }
      const { text, isError } = enrichBridgeResult('romaco_remove_indicator', result);
      return { content: [{ type: 'text' as const, text }], isError };
    },
  );
}
