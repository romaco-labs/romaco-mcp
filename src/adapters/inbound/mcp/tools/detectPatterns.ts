import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { ApplicationError } from '../../../../application/errors.js';
import type { ResolveThesisArtifactUseCase } from '../../../../application/use-cases/resolveThesisArtifact.js';
import { trimPatternHits } from '../../../../compression/snapshot.js';
import { registerCatalogContractTool } from '../catalogContractTool.js';
import type { RegisterContractToolOptions } from '../contracts.js';
import { detectPatternsDataSchema } from '../outputSchemas.js';

export function registerDetectPatterns(
  server: McpServer,
  resolveThesis: Pick<ResolveThesisArtifactUseCase, 'resolve'>,
  options: RegisterContractToolOptions = {},
): void {
  registerCatalogContractTool(
    server,
    'romaco_detect_patterns',
    {
      description:
        'Return deterministic pattern detections for the active analysis artifact. ' +
        'Default output omits anchor coordinates. Set acknowledgeHighTokenCost:true only after ' +
        'the user explicitly requests exact points.',
      inputSchema: z.object({
        acknowledgeHighTokenCost: z.literal(true).optional().describe(
          'Include exact timestamp/price/role anchors for every detected pattern.',
        ),
      }),
      dataSchema: detectPatternsDataSchema,
    },
    async ({ acknowledgeHighTokenCost }) => {
      try {
        const artifact = await resolveThesis.resolve();
        const full = artifact.summary.patterns;
        const patterns = acknowledgeHighTokenCost === true ? full : trimPatternHits(full);
        const format = acknowledgeHighTokenCost === true ? 'full' as const : 'concise' as const;
        return {
          data: {
            analysisId: artifact.analysisId,
            datasetId: artifact.datasetId,
            format,
            count: full.length,
            patterns,
          },
          // Preserve legacy JSON-array text for existing clients.
          summary: JSON.stringify(patterns, null, 2),
          context: {
            analysisId: artifact.analysisId,
            datasetId: artifact.datasetId,
          },
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (/no candle data loaded/i.test(message)) {
          throw new ApplicationError('SESSION_NOT_LOADED', message, {
            recovery: {
              action: 'load_dataset',
              instruction: 'Call romaco_load_candles before detecting patterns.',
            },
            cause: error,
          });
        }
        throw error;
      }
    },
    options,
  );
}
