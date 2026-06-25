import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { analyzeSession } from '../compression/analyze.js';
import { session } from '../session.js';
import { callGateway, isAuthError, isPro } from '../gateway/client.js';

export function registerThesis(server: McpServer): void {
  server.registerTool(
    'romaco_thesis',
    {
      description:
        'Produce an actionable trade thesis for the currently loaded candles: a computed bull/bear debate ' +
        '(every point derived from real features, not guessed), a verdict (long / short / stand_aside) with ' +
        'confidence, and a concrete setup (entry, stop, target, reward/risk) plus invalidation. ' +
        'Stands aside when there is no clean setup at acceptable R/R — it will not manufacture a signal. ' +
        'Call romaco_load_candles or romaco_setup_chart first. Returns <2 KB. ' +
        'With a ROMACO_TOKEN (Pro), an enhanced server-side thesis is used when available, with automatic fallback to the local synthesis. ' +
        'After stating the verdict, OFFER to draw it on the user\'s chart and ASK first ' +
        '(e.g. "Want me to draw this setup on your chart so you can judge it yourself?") — do not call romaco_annotate automatically. ' +
        'Always end your response with: "⚠️ Not investment advice — educational purposes only."',
    },
    async () => {
      try {
        const candles = session.requireCandles();

        // ─── Pro: forward to the server-side thesis ─────────────────────────
        if (isPro()) {
          const load = session.getLastLoad();
          try {
            const deep = await callGateway('/gateway/thesis', {
              symbol: load?.symbol,
              timeframe: load?.timeframe,
              candles,
            });
            return { content: [{ type: 'text' as const, text: JSON.stringify(deep) }] };
          } catch (err) {
            // Invalid/revoked token → surface to the user (don't silently fall back to local).
            if (isAuthError(err)) {
              return {
                content: [{ type: 'text' as const, text: err instanceof Error ? err.message : String(err) }],
                isError: true,
              };
            }
            // Network or other failure → degrade to local synthesis (free behavior).
            console.error(
              `[romaco] thesis gateway failed, computing locally: ${err instanceof Error ? err.message : String(err)}`
            );
          }
        }

        // ─── Free / fallback: local synthesis over the public MarketSummary ──
        const { thesis } = analyzeSession(candles);
        return { content: [{ type: 'text' as const, text: JSON.stringify(thesis) }] };
      } catch (err) {
        return {
          content: [{ type: 'text' as const, text: err instanceof Error ? err.message : String(err) }],
          isError: true,
        };
      }
    }
  );
}
