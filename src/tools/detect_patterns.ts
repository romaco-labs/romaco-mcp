import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { cachedDetectPatterns } from '../compression/scanCache.js';
import { trimPatternHits } from '../compression/snapshot.js';
import { session } from '../session.js';

export function registerDetectPatterns(server: McpServer): void {
  server.registerTool(
    'romaco_detect_patterns',
    {
      description:
        'Scan the currently loaded candle data for classical chart patterns: Head & Shoulders (and inverse), Double/Triple Top/Bottom (M/W — ATR-gated alignment + depth, no range-chop false positives), Ascending/Descending/Symmetric Triangles, Bull/Bear Flags, Parallel Channels (up/down/flat — strict gates: parallel fit, 5+ touches, close containment), Rising/Falling Wedges, Cup & Handle, Rounding Bottom (parabolic basin, no handle required), unfilled momentum Gaps (≥0.5×ATR, gap_up/gap_down), and Fibonacci harmonics: ABCD, Gartley, Bat, Butterfly, Crab (strict ratio gates ±0.05 — the math fits or no pattern is reported). ' +
        'Each hit returns kind, confidence (0..1), target_price, invalidation_price, and anchor_count. ' +
        'Zombie patterns are discarded: if any candle after a pattern completed already breached its invalidation level or tagged its target, the setup is consumed and never reported — even when the current price drifted back into the live band. ' +
        'Cost: compressed by default (<2 KB). Set acknowledgeHighTokenCost:true to receive the full anchor points[] for each hit (≈3× larger). ' +
        'Call romaco_load_candles first. To draw a detected pattern on the chart, offer romaco_draw_pattern.',
      inputSchema: {
        acknowledgeHighTokenCost: z
          .literal(true)
          .optional()
          .describe(
            'WARNING: setting this true includes the full points[] array (timestamp + price + role) for every detected pattern. ' +
            'Only opt in when the USER has explicitly asked for the exact anchor coordinates (e.g. to draw the pattern on the chart). ' +
            'Default (omit) returns trimmed hits without points[].',
          ),
      },
    },
    async ({ acknowledgeHighTokenCost }) => {
      try {
        const candles = session.requireCandles();
        // Pro delegation (server-side patterns) is planned; today this computes locally.
        const patterns = cachedDetectPatterns(candles);
        const payload = acknowledgeHighTokenCost === true ? patterns : trimPatternHits(patterns);
        return {
          content: [{ type: 'text' as const, text: JSON.stringify(payload, null, 2) }],
        };
      } catch (err) {
        return {
          content: [{ type: 'text' as const, text: err instanceof Error ? err.message : String(err) }],
          isError: true,
        };
      }
    },
  );
}
