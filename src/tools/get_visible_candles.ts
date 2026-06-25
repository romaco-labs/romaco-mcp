import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { bridge } from '../bridge.js';
import { compressVisibleCandles } from '../compression/snapshot.js';

export function registerGetVisibleCandles(server: McpServer): void {
  server.registerTool(
    'romaco_get_visible_candles',
    {
      description:
        'Summarize the OHLCV candles currently visible in the chart viewport: count, first/last candle, OHLC range, volume stats, percent change, ATR approximation. ' +
        'Cost: compressed by default (<1 KB). Set acknowledgeHighTokenCost:true to receive the raw OHLCV array (≈70 KB for a 360-candle viewport). ' +
        'Only opt in to the raw array when the user explicitly asked for raw candles (e.g. for custom indicator math). For analysis, prefer romaco_analyze_market.',
      inputSchema: {
        acknowledgeHighTokenCost: z
          .literal(true)
          .optional()
          .describe(
            'WARNING: setting this true returns the raw OHLCV array (≈70 KB at 360 candles, scales linearly). ' +
            'Only opt in when the USER has explicitly asked for raw candles and accepts the token cost. ' +
            'Default (omit) returns a compressed range summary.',
          ),
      },
    },
    async ({ acknowledgeHighTokenCost }) => {
      const ctx = (await bridge.getContext(true)) as { visibleCandles?: unknown[] };
      const candles = ctx?.visibleCandles ?? [];
      if (acknowledgeHighTokenCost === true) {
        return {
          content: [{ type: 'text' as const, text: JSON.stringify(candles, null, 2) }],
        };
      }
      const summary = compressVisibleCandles(candles as Parameters<typeof compressVisibleCandles>[0]);
      return {
        content: [{ type: 'text' as const, text: JSON.stringify(summary, null, 2) }],
      };
    },
  );
}
