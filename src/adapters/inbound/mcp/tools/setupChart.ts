import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { ApplicationError } from '../../../../application/errors.js';
import type { ResolveThesisArtifactUseCase } from '../../../../application/use-cases/resolveThesisArtifact.js';
import type { SetupChartUseCase } from '../../../../application/use-cases/setupChart.js';
import { trimPatternHits } from '../../../../compression/snapshot.js';
import type { MarketDataSource, Timeframe } from '../../../../domain/dataset/model.js';
import { registerCatalogContractTool } from '../catalogContractTool.js';
import type { RegisterContractToolOptions, ToolWarning } from '../contracts.js';
import { describeDataset, setupChartDataSchema, TIMEFRAMES } from '../outputSchemas.js';

export function registerSetupChart(
  server: McpServer,
  useCase: SetupChartUseCase,
  resolveThesis: ResolveThesisArtifactUseCase,
  presetNames: readonly string[],
  options: RegisterContractToolOptions = {},
): void {
  registerCatalogContractTool(
    server,
    'romaco_setup_chart',
    {
      description:
        'Prepare an identified OHLCV analysis dataset and run deterministic market analysis. ' +
        'When a browser chart is connected, preset indicators are applied only if live symbol and timeframe exactly match. ' +
        `Available presets: ${presetNames.join(', ')}.`,
      inputSchema: z.object({
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
        }).strict()).optional(),
      }),
      dataSchema: setupChartDataSchema,
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
        const artifact = await resolveThesis.resolveForDataset(result.dataset.datasetId);
        const { dataset } = result;
        const first = dataset.candles[0];
        const last = dataset.candles[dataset.candles.length - 1];
        const lines = [
          `✓ Loaded ${dataset.candles.length} candles — ${dataset.symbol} ${dataset.timeframe} via ${dataset.source}`,
          `  datasetId=${dataset.datasetId}`,
          `  analysisId=${artifact.analysisId} provider=${artifact.provider}`,
        ];
        if (first && last) {
          lines.push(
            `  Range: ${new Date(first.timestamp * 1000).toISOString().slice(0, 10)} → ${new Date(last.timestamp * 1000).toISOString().slice(0, 10)}`,
            `  Last close: ${last.close.toFixed(2)}`,
          );
        } else {
          lines.push('  No candles returned.');
        }

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

        const warnings: ToolWarning[] = [];
        if (result.liveStatus === 'disconnected') {
          warnings.push({ code: 'CHART_DISCONNECTED', message: 'Preset indicators were not applied.' });
        } else if (result.liveStatus === 'identity_mismatch') {
          warnings.push({ code: 'CHART_CONTEXT_MISMATCH', message: 'Preset indicators were skipped.' });
        } else if (result.liveStatus === 'unavailable') {
          warnings.push({ code: 'CHART_UNAVAILABLE', message: result.liveError ?? 'Chart identity unavailable.' });
        }
        const failedIndicators = result.indicators.filter((indicator) => !indicator.success);
        if (failedIndicators.length) {
          warnings.push({
            code: 'INDICATOR_PARTIAL_APPLY',
            message: `${failedIndicators.length} preset indicator(s) were rejected by the chart host.`,
          });
        }
        const resourceIds = result.indicators.flatMap(
          (indicator) => indicator.resourceId ? [indicator.resourceId] : [],
        );
        return {
          status: warnings.length ? 'partial' : 'ok',
          data: {
            dataset: describeDataset(dataset),
            analysisId: artifact.analysisId,
            provider: artifact.provider,
            analysis: artifact.summary,
            preset: {
              name: result.presetName,
              liveStatus: result.liveStatus,
              chartId: result.chartIdentity?.chartId ?? null,
              indicators: result.indicators,
            },
            resourceIds,
          },
          summary: lines.join('\n'),
          context: {
            chartId: result.chartIdentity?.chartId,
            datasetId: dataset.datasetId,
            analysisId: artifact.analysisId,
            symbol: dataset.symbol,
            timeframe: dataset.timeframe,
          },
          warnings,
        };
      } catch (error) {
        const selectedSource = source ?? 'yfinance';
        const message = error instanceof Error ? error.message : String(error);
        throw new ApplicationError(
          selectedSource === 'raw' ? 'INVALID_ARGUMENT' : 'DATA_SOURCE_UNAVAILABLE',
          `Failed to load data: ${message}`,
          {
            retryable: selectedSource !== 'raw',
            recovery: selectedSource === 'raw'
              ? { action: 'change_input', instruction: 'Correct raw OHLCV data and retry setup.' }
              : { action: 'retry', instruction: 'Retry later or provide rawCandles.' },
            cause: error,
          },
        );
      }
    },
    options,
  );
}
