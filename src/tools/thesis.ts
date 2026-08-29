import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { isPro } from '../gateway/client.js';
import type { ResolveThesisArtifactUseCase } from '../application/use-cases/resolveThesisArtifact.js';
import type { AnalysisRecord } from '../domain/analysis/model.js';

// Appended in-code so the disclaimer is guaranteed on every thesis output,
// independent of whether the model honors the description's instruction.
const DISCLAIMER = '\n\n⚠️ Not investment advice — educational purposes only.';

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
): void {
  server.registerTool(
    'romaco_thesis',
    {
      description:
        'Produce an actionable trade thesis for the currently loaded candles: a computed bull/bear debate ' +
        '(every point derived from real features, not guessed), a verdict (long / short / stand_aside) with ' +
        'confidence, and a concrete setup (entry, stop, target, reward/risk) plus invalidation. ' +
        'Stands aside when there is no clean setup at acceptable R/R — it will not manufacture a signal. ' +
        'Call romaco_load_candles or romaco_setup_chart first. Returns <2 KB. ' +
        'Local analysis returns a stable analysisId used by romaco_annotate. ' +
        'When ROMACO_TOKEN is set, remote candle egress remains disabled unless an authorized gateway artifact already exists. ' +
        'After stating the verdict, OFFER to draw it on the user\'s chart and ASK first ' +
        '(e.g. "Want me to draw this setup on your chart so you can judge it yourself?") — do not call romaco_annotate automatically. ' +
        'Always end your response with: "⚠️ Not investment advice — educational purposes only."',
    },
    async () => {
      try {
        if (isPro()) {
          const existing = await useCase.findExisting('gateway');
          if (!existing) {
            const local = await useCase.resolve();
            return { content: [{
              type: 'text' as const,
              text: serializeArtifact(local, 'remote egress disabled; computed locally'),
            }] };
          }
          return { content: [{ type: 'text' as const, text: serializeArtifact(existing) }] };
        }
        const artifact = await useCase.resolve();
        return { content: [{ type: 'text' as const, text: serializeArtifact(artifact) }] };
      } catch (error) {
        return {
          content: [{ type: 'text' as const, text: error instanceof Error ? error.message : String(error) }],
          isError: true,
        };
      }
    }
  );
}
