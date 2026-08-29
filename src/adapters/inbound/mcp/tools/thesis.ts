import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { ApplicationError } from '../../../../application/errors.js';
import type { ResolveThesisArtifactUseCase } from '../../../../application/use-cases/resolveThesisArtifact.js';
import type { AnalysisRecord } from '../../../../domain/analysis/model.js';
import { registerCatalogContractTool } from '../catalogContractTool.js';
import type { RegisterContractToolOptions, ToolWarning } from '../contracts.js';
import { thesisDataSchema } from '../outputSchemas.js';

const DISCLAIMER_TEXT = '⚠️ Not investment advice — educational purposes only.';
const DISCLAIMER = `\n\n${DISCLAIMER_TEXT}`;

function serializeArtifact(artifact: AnalysisRecord, warning?: string): string {
  return JSON.stringify({
    ...artifact.thesis,
    analysisId: artifact.analysisId,
    datasetId: artifact.datasetId,
    provider: artifact.provider,
    ...(warning ? { warning } : {}),
  }) + DISCLAIMER;
}

export function registerThesis(
  server: McpServer,
  useCase: ResolveThesisArtifactUseCase,
  options: RegisterContractToolOptions & { warnRemoteEgressDisabled?: boolean } = {},
): void {
  registerCatalogContractTool(
    server,
    'romaco_thesis',
    {
      description:
        'Produce an actionable trade thesis for the currently loaded candles: a computed bull/bear debate ' +
        '(every point derived from real features, not guessed), a verdict (long / short / stand_aside) with ' +
        'confidence, and a concrete setup (entry, stop, target, reward/risk) plus invalidation. ' +
        'Stands aside when there is no clean setup at acceptable R/R — it will not manufacture a signal. ' +
        'Call romaco_load_candles or romaco_setup_chart first. Returns <2 KB. ' +
        'Local analysis returns a stable analysisId used by romaco_annotate. ' +
        'Remote candle egress is disabled without a future explicit authorization contract. ' +
        'Pass analysisId to retrieve one exact stored artifact without reading or changing active state. ' +
        'After stating the verdict, offer to draw it and ask first; do not call romaco_annotate automatically.',
      inputSchema: z.object({
        analysisId: z.string().min(1).optional().describe(
          'Exact stored analysisId. Omit only for the current active dataset.',
        ),
      }),
      dataSchema: thesisDataSchema,
    },
    async ({ analysisId }) => {
      try {
        // Always local. Configuration alone can only request a warning; it
        // cannot select a gateway artifact or authorize network egress.
        const artifact: AnalysisRecord = await useCase.resolve(analysisId);
        const warning = options.warnRemoteEgressDisabled
          ? 'remote egress disabled; computed locally'
          : undefined;
        const warnings: ToolWarning[] = warning
          ? [{ code: 'REMOTE_EGRESS_DISABLED', message: warning }]
          : [];
        return {
          status: warnings.length ? 'partial' : 'ok',
          data: {
            analysisId: artifact.analysisId,
            datasetId: artifact.datasetId,
            provider: artifact.provider,
            thesis: artifact.thesis,
            disclaimer: DISCLAIMER_TEXT,
          },
          summary: serializeArtifact(artifact, warning),
          context: {
            datasetId: artifact.datasetId,
            analysisId: artifact.analysisId,
          },
          warnings,
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        const missingSession = !analysisId && /no candle data loaded/i.test(message);
        throw new ApplicationError(
          missingSession ? 'SESSION_NOT_LOADED' : 'ANALYSIS_NOT_FOUND',
          message,
          {
            recovery: missingSession
              ? { action: 'load_dataset', instruction: 'Call romaco_load_candles or romaco_setup_chart first.' }
              : {
                  action: 'select_analysis',
                  instruction: 'Use an analysisId returned by romaco_setup_chart or request a current thesis.',
                },
            cause: error,
          },
        );
      }
    },
    options,
  );
}
