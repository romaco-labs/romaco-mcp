import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { bridge } from '../bridge.js';
import { compressIndicatorValues } from '../compression/snapshot.js';
import { enrichBridgeResult } from './_guards.js';

export function registerGetIndicatorValues(server: McpServer): void {
  server.registerTool(
    'romaco_get_indicator_values',
    {
      description:
        'Read the current state of an indicator on the chart: last value, previous value, delta, and a per-indicator state classification ' +
        '(RSI: oversold/neutral/overbought; MACD: bull_cross/bear_cross/bullish/bearish; BOLL: squeeze/expansion/neutral; default: rising/falling/flat). ' +
        'Cost: compressed by default (<500 B). Set acknowledgeHighTokenCost:true to receive every bar of every series (~10 KB at 500 candles, scales linearly). ' +
        'Only opt in to raw series when the user explicitly asked for bar-by-bar values (e.g. for custom backtesting).',
      inputSchema: {
        indicatorId: z
          .string()
          .optional()
          .describe('Preferred lookup — the indicator id returned when it was added.'),
        indicatorName: z
          .string()
          .optional()
          .describe('Fallback lookup by name (case-insensitive, first match), e.g. "RSI".'),
        acknowledgeHighTokenCost: z
          .literal(true)
          .optional()
          .describe(
            'WARNING: setting this true returns the full per-bar series arrays (~10 KB for 500 bars, scales linearly). ' +
            'Only opt in when the USER has explicitly asked for raw indicator values and accepts the token cost. ' +
            'Default (omit) returns a compressed last/prev/delta/state summary.',
          ),
      },
    },
    async ({ indicatorId, indicatorName, acknowledgeHighTokenCost }) => {
      if (!indicatorId && !indicatorName) {
        return {
          content: [
            { type: 'text' as const, text: 'Provide either indicatorId or indicatorName.' },
          ],
          isError: true,
        };
      }
      const result = await bridge.executeAction({
        action: 'getIndicatorValues',
        indicatorId,
        indicatorName,
      });
      if (!result.success) {
        const { text, isError } = enrichBridgeResult('romaco_get_indicator_values', result);
        return { content: [{ type: 'text' as const, text }], isError };
      }
      const payload =
        acknowledgeHighTokenCost === true ? result.data : compressIndicatorValues(result.data);
      return { content: [{ type: 'text' as const, text: JSON.stringify(payload, null, 2) }] };
    },
  );
}
