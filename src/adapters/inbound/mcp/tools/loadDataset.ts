import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { LoadDatasetUseCase } from '../../../../application/use-cases/loadDataset.js';
import type { MarketDataSource, Timeframe } from '../../../../domain/dataset/model.js';

const TIMEFRAMES = [
  '1m', '2m', '5m', '15m', '30m',
  '1h', '2h', '4h',
  '1d', '5d', '1w', '1mo', '3mo',
] as const;

const SOURCES = ['yfinance', 'raw'] as const;

export function registerLoadDataset(server: McpServer, useCase: LoadDatasetUseCase): void {
  server.registerTool(
    'romaco_load_candles',
    {
      description:
        'Load and activate an identified OHLCV dataset. Subsequent analysis tools use this dataset. ' +
        'Returns datasetId for explicit workflow correlation. Failed loads preserve previous active state.',
      inputSchema: {
        source: z.enum(SOURCES).describe(
          '"yfinance" = Yahoo Finance. "raw" = pass rawCandles.',
        ),
        symbol: z.string().min(1).describe('Ticker symbol or raw dataset label.'),
        timeframe: z.enum(TIMEFRAMES).describe('Canonical candle interval.'),
        lookback: z.number().min(10).max(5000).optional(),
        rawCandles: z.array(z.object({
          timestamp: z.number(),
          open: z.number(),
          high: z.number(),
          low: z.number(),
          close: z.number(),
          volume: z.number(),
        })).optional(),
      },
    },
    async ({ source, symbol, timeframe, lookback, rawCandles }) => {
      try {
        const dataset = await useCase.execute({
          source: source as MarketDataSource,
          symbol,
          timeframe: timeframe as Timeframe,
          lookback,
          rawCandles,
        });
        const first = dataset.candles[0];
        const last = dataset.candles[dataset.candles.length - 1];
        const summary = dataset.candles.length === 0
          ? `No candles returned. datasetId=${dataset.datasetId}`
          : `Loaded ${dataset.candles.length} candles for ${dataset.symbol} ${dataset.timeframe} from ${dataset.source}. ` +
            `Range: ${new Date(first.timestamp * 1000).toISOString()} → ${new Date(last.timestamp * 1000).toISOString()}. ` +
            `Last close: ${last.close}. datasetId=${dataset.datasetId}`;
        return { content: [{ type: 'text' as const, text: summary }] };
      } catch (error) {
        return {
          content: [{
            type: 'text' as const,
            text: `Failed to load candles: ${error instanceof Error ? error.message : String(error)}. Previous session state preserved.`,
          }],
          isError: true,
        };
      }
    },
  );
}
