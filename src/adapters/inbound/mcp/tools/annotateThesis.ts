import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { ApplicationError } from '../../../../application/errors.js';
import type { AnnotateThesisUseCase } from '../../../../application/use-cases/annotateThesis.js';
import type { ResolveThesisArtifactUseCase } from '../../../../application/use-cases/resolveThesisArtifact.js';
import type { ApprovalPort, ApprovalScope } from '../../../../application/ports/approval.js';
import { registerCatalogContractTool } from '../catalogContractTool.js';
import type { RegisterContractToolOptions, ToolWarning } from '../contracts.js';
import { annotateDataSchema } from '../outputSchemas.js';

function mapAnnotateError(error: unknown): ApplicationError {
  if (error instanceof ApplicationError) return error;
  const message = error instanceof Error ? error.message : String(error);
  if (/chart shows/i.test(message)) {
    return new ApplicationError('CHART_CONTEXT_MISMATCH', message, {
      recovery: {
        action: 'match_chart_identity',
        instruction: 'Switch chart symbol/timeframe to match the selected analysis, then retry.',
      },
      cause: error,
    });
  }
  if (/no validated visible candles|chart has no/i.test(message)) {
    return new ApplicationError('CHART_NOT_READY', message, {
      retryable: true,
      recovery: { action: 'connect_chart', instruction: 'Load visible candles on the matching chart.' },
      cause: error,
    });
  }
  if (/analysis .* not found|stale for active dataset/i.test(message)) {
    return new ApplicationError('ANALYSIS_NOT_FOUND', message, {
      recovery: { action: 'select_analysis', instruction: 'Request a current thesis and use its analysisId.' },
      cause: error,
    });
  }
  if (/dataset .* not found/i.test(message)) {
    return new ApplicationError('DATASET_NOT_FOUND', message, {
      recovery: { action: 'load_dataset', instruction: 'Reload candles and request a new thesis.' },
      cause: error,
    });
  }
  if (/no candle data loaded/i.test(message)) {
    return new ApplicationError('SESSION_NOT_LOADED', message, {
      recovery: { action: 'load_dataset', instruction: 'Call romaco_load_candles first.' },
      cause: error,
    });
  }
  if (/no chart|not connected|disconnected|wait for mcpbridge/i.test(message)) {
    return new ApplicationError('CHART_NOT_CONNECTED', message, {
      retryable: true,
      recovery: { action: 'connect_chart', instruction: 'Connect a chart with McpBridge and retry.' },
      cause: error,
    });
  }
  return new ApplicationError('ACTION_DENIED', message, {
    recovery: { action: 'retry', instruction: 'Refresh matching chart state and retry after host approval.' },
    cause: error,
  });
}

export function registerAnnotate(
  server: McpServer,
  useCase: AnnotateThesisUseCase,
  resolveThesis: Pick<ResolveThesisArtifactUseCase, 'resolve'>,
  approvals: ApprovalPort,
  options: RegisterContractToolOptions = {},
): void {
  registerCatalogContractTool(
    server,
    'romaco_annotate',
    {
      description:
        'Atomically draw an exact stored thesis artifact on a matching live chart. ' +
        'Pass analysisId returned by romaco_thesis for explicit correlation. ' +
        'First call without approvalToken returns a one-time confirmation challenge and performs zero writes. ' +
        'After explicit user approval, retry with returned analysisId and approvalToken. ' +
        'Fails closed on stale analysis, Pro/local drift, symbol mismatch, timeframe mismatch, or host rejection.',
      inputSchema: z.object({
        analysisId: z.string().min(1).optional(),
        approvalToken: z.string().min(32).optional(),
      }),
      dataSchema: annotateDataSchema,
    },
    async ({ analysisId, approvalToken }) => {
      try {
        const artifact = await resolveThesis.resolve(analysisId);
        const scope: ApprovalScope = { action: 'romaco_annotate', resourceId: artifact.analysisId };
        if (!approvalToken) {
          const challenge = approvals.issue(scope);
          throw new ApplicationError('APPROVAL_REQUIRED', 'Explicit user approval is required before annotation.', {
            recovery: {
              action: 'request_approval',
              instruction: 'Ask the user to approve this exact analysis, then retry with analysisId and approvalToken.',
              parameters: {
                analysisId: artifact.analysisId,
                approvalToken: challenge.token,
                expiresAt: challenge.expiresAt,
              },
            },
          });
        }
        const approval = approvals.consume(scope, approvalToken);
        if (approval !== 'approved') {
          throw new ApplicationError('APPROVAL_INVALID', `Annotation approval token is ${approval}.`, {
            recovery: {
              action: 'request_approval',
              instruction: 'Request a new approval challenge for this analysisId.',
              parameters: { analysisId: artifact.analysisId },
            },
          });
        }
        const result = await useCase.execute(artifact.analysisId);
        const thesis = result.artifact.thesis;
        const setup = thesis.setup;
        const setupText = setup
          ? ` entry ${setup.entry} / stop ${setup.stop} / target ${setup.target} (R/R ${setup.rr});`
          : '';
        const warnings: ToolWarning[] = result.resourceIds.length === result.drawings.length
          ? []
          : [{
              code: 'RESOURCE_IDS_INCOMPLETE',
              message: `Host returned ${result.resourceIds.length} IDs for ${result.drawings.length} drawings.`,
            }];
        return {
          status: warnings.length ? 'partial' : 'ok',
          data: {
            analysisId: result.artifact.analysisId,
            datasetId: result.dataset.datasetId,
            chartId: result.chartIdentity.chartId,
            symbol: result.dataset.symbol,
            timeframe: result.dataset.timeframe,
            provider: result.artifact.provider,
            verdict: thesis.verdict,
            groupId: result.groupId,
            drawingIds: [...result.resourceIds],
            drawingCount: result.drawings.length,
            scope: thesis.verdict === 'stand_aside' || !setup ? 'context' as const : 'trade' as const,
            idempotencyKey: result.idempotencyKey,
          },
          summary:
            `Annotated ${thesis.verdict}:${setupText} ${result.drawings.length} layer(s). ` +
            `analysisId=${result.artifact.analysisId} datasetId=${result.dataset.datasetId} ` +
            `chartId=${result.chartIdentity.chartId} idempotencyKey=${result.idempotencyKey}`,
          context: {
            chartId: result.chartIdentity.chartId,
            datasetId: result.dataset.datasetId,
            analysisId: result.artifact.analysisId,
            symbol: result.dataset.symbol,
            timeframe: result.dataset.timeframe,
          },
          warnings,
        };
      } catch (error) {
        throw mapAnnotateError(error);
      }
    },
    options,
  );
}
