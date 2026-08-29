import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { ApplicationError } from '../../../../application/errors.js';
import type { LoadDatasetUseCase } from '../../../../application/use-cases/loadDataset.js';
import type { MarketDataSource, Timeframe } from '../../../../domain/dataset/model.js';
import { registerCatalogContractTool } from '../catalogContractTool.js';
import type { RegisterContractToolOptions } from '../contracts.js';
import { describeDataset, loadDatasetDataSchema, TIMEFRAMES } from '../outputSchemas.js';

const SOURCES = ['yfinance', 'raw'] as const;

export function registerLoadDataset(
  server: McpServer,
  useCase: LoadDatasetUseCase,
  options: RegisterContractToolOptions = {},
): void {
  registerCatalogContractTool(
    server,
    'romaco_load_candles',
    {
      description:
        'Load and activate an identified OHLCV dataset. Subsequent analysis tools use this dataset. ' +
        'Returns datasetId for explicit workflow correlation. Failed loads preserve previous active state.',
      inputSchema: z.object({
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
        }).strict()).optional(),
      }),
      dataSchema: loadDatasetDataSchema,
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
        return {
          data: { dataset: describeDataset(dataset) },
          summary,
          context: {
            datasetId: dataset.datasetId,
            symbol: dataset.symbol,
            timeframe: dataset.timeframe,
          },
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        throw new ApplicationError(
          source === 'raw' ? 'INVALID_ARGUMENT' : 'DATA_SOURCE_UNAVAILABLE',
          `Failed to load candles: ${message}. Previous session state preserved.`,
          {
            retryable: source !== 'raw',
            recovery: source === 'raw'
              ? { action: 'change_input', instruction: 'Provide a non-empty, valid OHLCV rawCandles array.' }
              : { action: 'retry', instruction: 'Retry the market-data request later or provide rawCandles.' },
            cause: error,
          },
        );
      }
    },
    options,
  );
}
