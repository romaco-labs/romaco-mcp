import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { composeMarketSummary } from '../compression/summary.js';
import { session } from '../session.js';
import { callGateway, isAuthError, isPro } from '../gateway/client.js';

export function registerAnalyzeMarket(server: McpServer): void {
  server.registerTool(
    'romaco_analyze_market',
    {
      description:
        'Run full technical analysis on the currently loaded candle data and return a compressed MarketSummary. ' +
        'Includes trend (direction + strength), piecewise linear price action, support/resistance levels (clustering), ' +
        'momentum (RSI, MACD, divergences), volatility (ATR, Bollinger Bands), and detected patterns (H&S, double top/bottom, triangles, flags). ' +
        'Call romaco_load_candles first. Returns ~500 tokens of structured features instead of raw OHLCV. ' +
        'With a ROMACO_TOKEN (Pro), this is computed server-side when available, with automatic fallback to local compute.',
    },
    async () => {
      try {
        const candles = session.requireCandles();

        // ─── Pro: forward the heavy compute to the server-side gateway ──────
        if (isPro()) {
          const load = session.getLastLoad();
          try {
            const summary = await callGateway('/gateway/analyze', {
              symbol: load?.symbol,
              timeframe: load?.timeframe,
              candles,
            });
            return {
              content: [{ type: 'text' as const, text: JSON.stringify(summary, null, 2) }],
            };
          } catch (err) {
            // Invalid/revoked token → surface to the user (don't silently fall back to local).
            if (isAuthError(err)) {
              return {
                content: [{ type: 'text' as const, text: err instanceof Error ? err.message : String(err) }],
                isError: true,
              };
            }
            // Network or other failure → degrade to local compute (free behavior).
            console.error(
              `[romaco] gateway delegation failed, computing locally: ${err instanceof Error ? err.message : String(err)}`
            );
          }
        }

        // ─── Free / fallback: local compute ─────────────────────────────────
        const summary = composeMarketSummary(candles);
        return {
          content: [{ type: 'text' as const, text: JSON.stringify(summary, null, 2) }],
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
