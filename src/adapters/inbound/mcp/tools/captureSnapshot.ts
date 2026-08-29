import { createHash } from 'node:crypto';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { ApplicationError } from '../../../../application/errors.js';
import type { ChartPort } from '../../../../application/ports/chart.js';
import { registerCatalogContractTool } from '../catalogContractTool.js';
import type { RegisterContractToolOptions } from '../contracts.js';
import { snapshotDataSchema } from '../outputSchemas.js';

function snapshotError(error: unknown): ApplicationError {
  if (error instanceof ApplicationError) return error;
  const message = error instanceof Error ? error.message : String(error);
  const disconnected = /no chart|not connected|disconnected|wait for mcpbridge/i.test(message);
  return new ApplicationError(disconnected ? 'CHART_NOT_CONNECTED' : 'CHART_NOT_READY', message, {
    retryable: true,
    recovery: {
      action: 'connect_chart',
      instruction: 'Connect a ready chart with McpBridge and retry snapshot capture.',
    },
    cause: error,
  });
}

export function registerCaptureSnapshot(
  server: McpServer,
  chart: ChartPort,
  options: RegisterContractToolOptions = {},
): void {
  registerCatalogContractTool(
    server,
    'romaco_capture_snapshot',
    {
      description:
        'Capture the current chart as PNG or JPEG. Cost: image payload can be large. ' +
        'Call only after explicit user request and pass acknowledgeHighTokenCost:true. ' +
        'Structured output contains integrity metadata, never duplicate base64.',
      inputSchema: z.object({
        format: z.enum(['png', 'jpeg']).optional(),
        acknowledgeHighTokenCost: z.literal(true).optional(),
      }),
      dataSchema: snapshotDataSchema,
    },
    async ({ format = 'png', acknowledgeHighTokenCost }) => {
      if (acknowledgeHighTokenCost !== true) {
        throw new ApplicationError('ACK_REQUIRED', 'Chart snapshot payload cost must be acknowledged.', {
          recovery: {
            action: 'acknowledge_cost',
            instruction: 'After explicit user request, retry with acknowledgeHighTokenCost:true.',
            parameters: { acknowledgeHighTokenCost: true, format },
          },
        });
      }
      try {
        const identity = await chart.getIdentity();
        const snapshot = await chart.captureSnapshot(format);
        const base64 = snapshot.dataUrl.split(',')[1] ?? snapshot.dataUrl;
        const bytes = Buffer.from(base64, 'base64');
        const mimeType = format === 'jpeg' ? 'image/jpeg' as const : 'image/png' as const;
        return {
          data: {
            format,
            mimeType,
            byteLength: bytes.byteLength,
            sha256: createHash('sha256').update(bytes).digest('hex'),
          },
          summary: `Chart snapshot captured (${mimeType}, ${bytes.byteLength} bytes).`,
          context: {
            chartId: identity.chartId,
            symbol: identity.symbol,
            timeframe: identity.timeframe,
            datasetId: identity.datasetId,
          },
          content: [{ type: 'image', data: base64, mimeType }],
        };
      } catch (error) {
        throw snapshotError(error);
      }
    },
    options,
  );
}
