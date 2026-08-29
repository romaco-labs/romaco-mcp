import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import {
  decodeSnapshotDataUrl,
  registerCaptureSnapshot,
} from '../../../src/adapters/inbound/mcp/tools/captureSnapshot.js';
import type { ChartPort } from '../../../src/application/ports/chart.js';
import { createChartId, MAX_CHART_TRANSFER_BYTES } from '../../../src/domain/chart/model.js';

const identity = {
  chartId: createChartId('chart-aapl'), symbol: 'AAPL', timeframe: '1d' as const,
};
const PNG = 'data:image/png;base64,iVBORw0KGgo=';
const JPEG = 'data:image/jpeg;base64,/9j/2Q==';

describe('snapshot browser-output contract', () => {
  let server: McpServer;
  let client: Client;
  let dataUrl: unknown;

  beforeEach(async () => {
    dataUrl = PNG;
    const chart: ChartPort = {
      isConnected: () => true,
      getIdentity: async () => identity,
      getContext: async () => ({ identity }),
      execute: async () => ({ success: true }),
      replaceDrawingGroup: async () => ({ success: true }),
      captureSnapshot: async (format) => ({ format, dataUrl: dataUrl as string }),
    };
    server = new McpServer({ name: 'snapshot-contract-test', version: '0.0.0' });
    registerCaptureSnapshot(server, chart);
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await server.connect(serverTransport);
    client = new Client({ name: 'test-client', version: '0.0.0' }, { capabilities: {} });
    await client.connect(clientTransport);
  });

  afterEach(async () => {
    await client.close();
    await server.close();
  });

  it('accepts canonical MIME-matched PNG and JPEG signatures', () => {
    expect(decodeSnapshotDataUrl(PNG, 'png')).toMatchObject({
      base64: 'iVBORw0KGgo=', mimeType: 'image/png', bytes: expect.any(Buffer),
    });
    expect(decodeSnapshotDataUrl(JPEG, 'jpeg')).toMatchObject({
      base64: '/9j/2Q==', mimeType: 'image/jpeg', bytes: expect.any(Buffer),
    });
  });

  it.each([
    ['wrong MIME', JPEG, 'png'],
    ['empty bytes', 'data:image/png;base64,', 'png'],
    ['noncanonical base64', 'data:image/png;base64,iVBORw0KGgo', 'png'],
    ['spoofed bytes', 'data:image/png;base64,ZmFrZQ==', 'png'],
  ] as const)('rejects %s before MCP image output', (_name, value, format) => {
    expect(() => decodeSnapshotDataUrl(value, format)).toThrowError(expect.objectContaining({
      code: 'CHART_NOT_READY',
    }));
  });

  it('rejects decoded output beyond bridge transfer bound', () => {
    const oversized = `data:image/png;base64,${Buffer.alloc(MAX_CHART_TRANSFER_BYTES + 1).toString('base64')}`;
    expect(() => decodeSnapshotDataUrl(oversized, 'png')).toThrowError(expect.objectContaining({
      code: 'CHART_NOT_READY',
    }));
  });

  it('returns typed fail-closed MCP error and no image block for invalid host payload', async () => {
    dataUrl = JPEG;
    const result = await client.callTool({
      name: 'romaco_capture_snapshot',
      arguments: { format: 'png', acknowledgeHighTokenCost: true },
    });

    expect(result.isError).toBe(true);
    expect(result.structuredContent).toMatchObject({
      status: 'error',
      data: null,
      error: { code: 'CHART_NOT_READY', retryable: true },
    });
    expect(result.content.some((block) => block.type === 'image')).toBe(false);
  });
});
