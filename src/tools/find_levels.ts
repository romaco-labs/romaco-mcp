import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { findLevels } from '../compression/levels.js';
import { session } from '../session.js';

export function registerFindLevels(server: McpServer): void {
  server.registerTool(
    'romaco_find_levels',
    {
      description:
        'Find key support and resistance price levels for the currently loaded candle data using 1D K-means clustering on swing extremes, plus Volume Profile (POC, VAH, VAL). ' +
        'Returns up to 3 support levels (below current price) and 3 resistance levels (above), each with touch count, strength (0..1, touch-count × recency), and last-test timestamp. ' +
        'Call romaco_load_candles first.',
    },
    async () => {
      try {
        const candles = session.requireCandles();
        // Pro delegation (server-side levels) is planned; today this computes locally.
        const levels = findLevels(candles, { withDetail: true });
        return {
          content: [{ type: 'text' as const, text: JSON.stringify(levels, null, 2) }],
        };
      } catch (err) {
        return {
          content: [{ type: 'text' as const, text: err instanceof Error ? err.message : String(err) }],
          isError: true,
        };
      }
    }
  );
}
