import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { composeMarketSummary } from '../compression/summary.js';
import { session } from '../session.js';

export function registerAnalyzeMarket(server: McpServer): void {
  server.registerTool(
    'romaco_analyze_market',
    {
      description:
        'Run full technical analysis on the currently loaded candle data and return a compressed MarketSummary. ' +
        'Includes trend (direction + strength), piecewise linear price action, support/resistance levels (clustering), ' +
        'momentum (RSI, MACD, divergences), volatility (ATR, Bollinger Bands), and detected patterns (H&S, double top/bottom, triangles, flags). ' +
        'Call romaco_load_candles first. Returns ~500 tokens of structured features instead of raw OHLCV. ' +
        'Computed locally. Remote candle egress is disabled without a future explicit authorization contract.',
    },
    async () => {
      try {
        const candles = session.requireCandles();
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
