import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { SetupChartUseCase } from '../../../../application/use-cases/setupChart.js';
import { trimPatternHits } from '../../../../compression/snapshot.js';
import type { MarketDataSource, Timeframe } from '../../../../domain/dataset/model.js';

const TIMEFRAMES = [
  '1m', '2m', '5m', '15m', '30m',
  '1h', '2h', '4h',
  '1d', '5d', '1w', '1mo', '3mo',
] as const;

export function registerSetupChart(
  server: McpServer,
  useCase: SetupChartUseCase,
  presetNames: readonly string[],
): void {
  server.registerTool(
    'romaco_setup_chart',
    {
      description:
        'Prepare an identified OHLCV analysis dataset and run deterministic market analysis. ' +
        'When a browser chart is connected, preset indicators are applied only if live symbol and timeframe exactly match. ' +
        `Available presets: ${presetNames.join(', ')}.`,
      inputSchema: {
        symbol: z.string().min(1),
        preset: z.string().refine((value) => presetNames.includes(value), {
          message: `Preset must be one of: ${presetNames.join(', ')}`,
        }).optional(),
        timeframe: z.enum(TIMEFRAMES).optional(),
        source: z.enum(['yfinance', 'raw']).optional(),
        lookback: z.number().min(50).max(2000).optional(),
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
    async ({ symbol, preset, timeframe, source, lookback, rawCandles }) => {
      try {
        const result = await useCase.execute({
          symbol,
          presetName: preset,
          timeframe: timeframe as Timeframe | undefined,
          source: source as MarketDataSource | undefined,
          lookback,
          rawCandles,
        });
        const { dataset } = result;
        const first = dataset.candles[0];
        const last = dataset.candles[dataset.candles.length - 1];
        const lines = [
          `✓ Loaded ${dataset.candles.length} candles — ${dataset.symbol} ${dataset.timeframe} via ${dataset.source}`,
          `  datasetId=${dataset.datasetId}`,
          `  Range: ${new Date(first.timestamp * 1000).toISOString().slice(0, 10)} → ${new Date(last.timestamp * 1000).toISOString().slice(0, 10)}`,
          `  Last close: ${last.close.toFixed(2)}`,
        ];

        if (result.liveStatus === 'disconnected') {
          lines.push('\n⚠ No browser connected — preset not applied. Headless analysis is ready.');
        } else if (result.liveStatus === 'identity_mismatch') {
          const actual = result.chartIdentity;
          lines.push(
            `\n⚠ Live preset skipped: chart is ${actual?.symbol ?? 'unknown'} ${actual?.timeframe ?? 'unknown'}, ` +
            `analysis is ${dataset.symbol} ${dataset.timeframe}.`,
          );
        } else if (result.liveStatus === 'unavailable') {
          lines.push(`\n⚠ Live preset unavailable: ${result.liveError ?? 'chart identity unavailable'}`);
        } else if (result.liveStatus === 'matched') {
          lines.push(`\nPreset "${result.presetName}" results:`);
          for (const indicator of result.indicators) {
            const label = indicator.params
              ? `${indicator.type}(${indicator.params.join(', ')})`
              : indicator.type;
            lines.push(indicator.success
              ? `  + ${label}${indicator.resourceId ? ` [${indicator.resourceId}]` : ''}`
              : `  ✗ ${label}: ${indicator.error ?? 'chart rejected action'}`);
          }
        }

        const compactSummary = {
          ...result.summary,
          plr: result.summary.plr.slice(-4),
          patterns: trimPatternHits(result.summary.patterns)
            .sort((left, right) => right.confidence - left.confidence)
            .slice(0, 5),
        };
        lines.push('\n─── Market Analysis ───', JSON.stringify(compactSummary));
        return { content: [{ type: 'text' as const, text: lines.join('\n') }] };
      } catch (error) {
        return {
          content: [{
            type: 'text' as const,
            text: `Failed to load data: ${error instanceof Error ? error.message : String(error)}`,
          }],
          isError: true,
        };
      }
    },
  );
}
