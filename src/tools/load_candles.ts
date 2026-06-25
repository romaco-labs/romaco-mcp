import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { loadCandles } from '../data/loader.js';
import { session } from '../session.js';
import type { Timeframe, DataSourceName } from '../data/types.js';

const TIMEFRAMES = [
  '1m', '2m', '5m', '15m', '30m',
  '1h', '2h', '4h',
  '1d', '5d', '1w', '1mo', '3mo',
] as const;

const SOURCES = ['yfinance', 'raw'] as const;

export function registerLoadCandles(server: McpServer): void {
  server.registerTool(
    'romaco_load_candles',
    {
      description:
        'Load OHLCV candle data from a data source. Once loaded, the data persists in the MCP session and is used by all subsequent analysis tools (analyze_market, find_levels, detect_patterns). Default source is "yfinance" (free, no auth). Use "raw" to pass your own candle array.',
      inputSchema: {
        source: z.enum(SOURCES).describe(
          '"yfinance" = Yahoo Finance (free, no API key needed, OHLCV for stocks/ETFs/crypto/FX). "raw" = pass your own candle array via rawCandles.'
        ),
        symbol: z.string().describe('Ticker symbol (e.g., "AAPL", "TSLA", "BTC-USD", "EURUSD=X"). For raw source, this is just a label.'),
        timeframe: z.enum(TIMEFRAMES).describe(
          'Candle interval. Intraday: 1m, 2m, 5m, 15m, 30m, 1h, 2h, 4h. Daily+: 1d, 5d, 1w, 1mo, 3mo.'
        ),
        lookback: z
          .number()
          .min(10)
          .max(5000)
          .optional()
          .describe('Number of recent candles to fetch (default 500, max 5000).'),
        rawCandles: z
          .array(z.object({
            timestamp: z.number(),
            open: z.number(),
            high: z.number(),
            low: z.number(),
            close: z.number(),
            volume: z.number(),
          }))
          .optional()
          .describe('Only used when source="raw". Array of {timestamp, open, high, low, close, volume}.'),
      },
    },
    async ({ source, symbol, timeframe, lookback, rawCandles }) => {
      try {
        const result = await loadCandles({
          source: source as DataSourceName,
          symbol,
          timeframe: timeframe as Timeframe,
          lookback,
          rawCandles,
        });
        session.setLastLoad(result);

        const first = result.candles[0];
        const last = result.candles[result.candles.length - 1];
        const summary = result.candles.length === 0
          ? 'No candles returned.'
          : `Loaded ${result.candles.length} candles for ${symbol} ${timeframe} from ${source}. ` +
            `Range: ${new Date(first.timestamp * 1000).toISOString()} → ${new Date(last.timestamp * 1000).toISOString()}. ` +
            `Last close: ${last.close}.`;

        return { content: [{ type: 'text' as const, text: summary }] };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return {
          content: [{
            type: 'text' as const,
            text: `Failed to load candles: ${msg}. Previous session state preserved.`,
          }],
          isError: true,
        };
      }
    }
  );
}
