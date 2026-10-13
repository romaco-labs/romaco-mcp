import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { ApplicationError } from '../../../../application/errors.js';
import type { AnalyzeBatchItem, AnalyzeBatchUseCase } from '../../../../application/use-cases/analyzeBatch.js';
import type { Timeframe } from '../../../../domain/dataset/model.js';
import { BATCH_SCORE_SEMANTICS, confidenceSemanticsFor } from '../../../../domain/analysis/semantics.js';
import { registerCatalogContractTool } from '../catalogContractTool.js';
import type { RegisterContractToolOptions } from '../contracts.js';
import { thesisBatchDataSchema, TIMEFRAMES } from '../outputSchemas.js';

const DISCLAIMER = '⚠️ Not investment advice — educational purposes only.';
const SCORE_NOTICE = 'Scores are heuristic ranks (zero without a setup), not win probabilities or expected returns.';

function describeItem(item: AnalyzeBatchItem) {
  const { dataset, artifact, score } = item;
  return {
    symbol: dataset.symbol,
    timeframe: dataset.timeframe,
    datasetId: dataset.datasetId,
    analysisId: artifact.analysisId,
    dataProvenance: artifact.dataProvenance ?? null,
    verdict: artifact.thesis.verdict,
    confidence: artifact.thesis.confidence,
    confidenceSemantics: confidenceSemanticsFor(artifact.provider),
    score,
    setup: artifact.thesis.setup,
  };
}

export function registerThesisBatch(
  server: McpServer,
  useCase: AnalyzeBatchUseCase,
  options: RegisterContractToolOptions = {},
): void {
  registerCatalogContractTool(
    server,
    'romaco_thesis_batch',
    {
      description:
        'Load and rank up to ten symbols through the configured MarketDataPort. ' +
        'For valid setups, R/R times uncalibrated confidence is a heuristic rank; without a setup, score is zero. ' +
        'Neither is expectancy or win probability. ' +
        'Returns exact datasetId/analysisId pairs, preserves successful items on partial failure, ' +
        'and activates the ranked top item for explicit follow-up.',
      inputSchema: z.object({
        symbols: z.array(z.string().min(1)).min(1).max(10),
        timeframe: z.enum(TIMEFRAMES).optional(),
        lookback: z.number().int().min(50).max(2000).optional(),
      }),
      dataSchema: thesisBatchDataSchema,
    },
    async ({ symbols, timeframe = '1d', lookback = 300 }) => {
      try {
        const result = await useCase.execute({
          symbols,
          timeframe: timeframe as Timeframe,
          lookback,
        });
        const items = result.items.map(describeItem);
        const top = describeItem(result.top);
        const failures = result.failures.map(({ symbol }) => ({
          symbol,
          code: 'DATA_SOURCE_UNAVAILABLE' as const,
          message: `${symbol} market data unavailable.`,
          recovery: {
            action: 'retry' as const,
            instruction: `Retry ${symbol} later or analyze another available symbol.`,
          },
        }));
        const lines = items.map((item, index) =>
          `${index + 1}. ${item.symbol} ${item.verdict} score=${item.score.toFixed(4)} ` +
          `datasetId=${item.datasetId} analysisId=${item.analysisId}`
        );
        if (failures.length) lines.push(`Unavailable: ${failures.map((failure) => failure.symbol).join(', ')}`);
        lines.push(SCORE_NOTICE);
        lines.push(DISCLAIMER);
        return {
          status: failures.length ? 'partial' as const : 'ok' as const,
          data: {
            items,
            top,
            scoreSemantics: BATCH_SCORE_SEMANTICS,
            failures,
            sessionDatasetId: top.datasetId,
            disclaimer: DISCLAIMER,
          },
          summary: lines.join('\n'),
          context: {
            datasetId: top.datasetId,
            analysisId: top.analysisId,
            symbol: top.symbol,
            timeframe: top.timeframe,
          },
          warnings: failures.length ? [{
            code: 'BATCH_PARTIAL',
            message: `${failures.length} symbol(s) could not be loaded.`,
          }] : [],
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (/all requested symbols failed/i.test(message)) {
          throw new ApplicationError('DATA_SOURCE_UNAVAILABLE', message, {
            retryable: true,
            recovery: { action: 'retry', instruction: 'Retry later or request different symbols.' },
            cause: error,
          });
        }
        throw error;
      }
    },
    options,
  );
}
