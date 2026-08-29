import { createHash } from 'node:crypto';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { ApplicationError } from '../../../../application/errors.js';
import type { ChartPort } from '../../../../application/ports/chart.js';
import { MAX_CHART_TRANSFER_BYTES } from '../../../../domain/chart/model.js';
import { registerCatalogContractTool } from '../catalogContractTool.js';
import type { RegisterContractToolOptions } from '../contracts.js';
import { snapshotDataSchema } from '../outputSchemas.js';

const SNAPSHOT_MIME = {
  png: 'image/png',
  jpeg: 'image/jpeg',
} as const;

function invalidSnapshot(reason: string): ApplicationError {
  return new ApplicationError('CHART_NOT_READY', `Chart returned an invalid snapshot payload: ${reason}.`, {
    retryable: true,
    recovery: {
      action: 'retry',
      instruction: 'Refresh the paired chart or upgrade romaco-charts, then retry snapshot capture.',
    },
  });
}

function hasExpectedSignature(format: 'png' | 'jpeg', bytes: Buffer): boolean {
  if (format === 'png') {
    return bytes.length >= 8
      && bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  }
  return bytes.length >= 4
    && bytes[0] === 0xff
    && bytes[1] === 0xd8
    && bytes[2] === 0xff
    && bytes[bytes.length - 2] === 0xff
    && bytes[bytes.length - 1] === 0xd9;
}

/** Validate untrusted browser output before exposing image content to MCP. */
export function decodeSnapshotDataUrl(
  value: unknown,
  format: 'png' | 'jpeg',
): { base64: string; bytes: Buffer; mimeType: (typeof SNAPSHOT_MIME)[typeof format] } {
  if (typeof value !== 'string') throw invalidSnapshot('expected a data URL string');
  const mimeType = SNAPSHOT_MIME[format];
  const prefix = `data:${mimeType};base64,`;
  const maxEncodedLength = Math.ceil(MAX_CHART_TRANSFER_BYTES / 3) * 4;
  if (!value.startsWith(prefix)) throw invalidSnapshot(`MIME must be ${mimeType}`);
  if (value.length > prefix.length + maxEncodedLength) throw invalidSnapshot('decoded image exceeds size limit');
  const base64 = value.slice(prefix.length);
  if (!base64 || base64.length % 4 !== 0 || !/^[A-Za-z0-9+/]+={0,2}$/.test(base64)) {
    throw invalidSnapshot('base64 encoding is not canonical');
  }
  const bytes = Buffer.from(base64, 'base64');
  if (bytes.length === 0) throw invalidSnapshot('decoded image is empty');
  if (bytes.length > MAX_CHART_TRANSFER_BYTES) throw invalidSnapshot('decoded image exceeds size limit');
  if (bytes.toString('base64') !== base64) throw invalidSnapshot('base64 encoding is not canonical');
  if (!hasExpectedSignature(format, bytes)) throw invalidSnapshot(`bytes do not match ${mimeType}`);
  return { base64, bytes, mimeType };
}

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
        'MIME, canonical base64, file signature, and transfer size are validated before output. ' +
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
        const { base64, bytes, mimeType } = decodeSnapshotDataUrl(snapshot.dataUrl, format);
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
