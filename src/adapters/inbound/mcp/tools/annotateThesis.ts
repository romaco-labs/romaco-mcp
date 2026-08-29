import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { AnnotateThesisUseCase } from '../../../../application/use-cases/annotateThesis.js';

export function registerAnnotate(
  server: McpServer,
  useCase: AnnotateThesisUseCase,
): void {
  server.registerTool(
    'romaco_annotate',
    {
      description:
        'Atomically draw an exact stored thesis artifact on a matching live chart. ' +
        'Pass analysisId returned by romaco_thesis for explicit correlation. ' +
        'Fails closed on stale analysis, Pro/local drift, symbol mismatch, timeframe mismatch, or host rejection.',
      inputSchema: {
        analysisId: z.string().min(1).optional(),
      },
    },
    async ({ analysisId }) => {
      try {
        const result = await useCase.execute(analysisId);
        const thesis = result.artifact.thesis;
        const setup = thesis.setup;
        const setupText = setup
          ? ` entry ${setup.entry} / stop ${setup.stop} / target ${setup.target} (R/R ${setup.rr});`
          : '';
        return {
          content: [{
            type: 'text' as const,
            text:
              `Annotated ${thesis.verdict}:${setupText} ${result.drawings.length} layer(s). ` +
              `analysisId=${result.artifact.analysisId} datasetId=${result.dataset.datasetId} ` +
              `chartId=${result.chartIdentity.chartId} idempotencyKey=${result.idempotencyKey}`,
          }],
        };
      } catch (error) {
        return {
          content: [{
            type: 'text' as const,
            text: `romaco_annotate: ${error instanceof Error ? error.message : String(error)}`,
          }],
          isError: true,
        };
      }
    },
  );
}
