import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { registerAddIndicator } from '../../../src/adapters/inbound/mcp/tools/addIndicator.js';
import type { ChartPort } from '../../../src/application/ports/chart.js';
import { createChartId } from '../../../src/domain/chart/model.js';

const identity = {
  chartId: createChartId('chart-aapl'), symbol: 'AAPL', timeframe: '1d' as const,
};

describe('romaco_add_indicator legacy-ID contract', () => {
  let server: McpServer;
  let client: Client;
  let execute: ReturnType<typeof vi.fn>;
  let recordIndicator: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    execute = vi.fn(async () => ({ success: true }));
    recordIndicator = vi.fn();
    const chart: ChartPort = {
      isConnected: () => true,
      getIdentity: async () => identity,
      getContext: async () => ({ identity }),
      execute,
      replaceDrawingGroup: vi.fn(),
      captureSnapshot: vi.fn(),
    };
    server = new McpServer({ name: 'add-indicator-contract-test', version: '0.0.0' });
    registerAddIndicator(server, chart, { recordIndicator, replaceDrawingGroup: vi.fn() });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await server.connect(serverTransport);
    client = new Client({ name: 'test-client', version: '0.0.0' }, { capabilities: {} });
    await client.connect(clientTransport);
  });

  afterEach(async () => {
    await client.close();
    await server.close();
  });

  it('journals successful write and reports partial instead of error when host omits ID', async () => {
    const result = await client.callTool({
      name: 'romaco_add_indicator',
      arguments: { indicatorType: 'RSI', params: [14] },
    });

    expect(result.isError).not.toBe(true);
    expect(result.structuredContent).toMatchObject({
      status: 'partial',
      data: {
        indicator: { indicatorId: null, type: 'RSI', params: [14] },
        applied: true,
      },
      context: { chartId: 'chart-aapl', symbol: 'AAPL', timeframe: '1d' },
      warnings: [{ code: 'RESOURCE_ID_UNAVAILABLE' }],
    });
    expect(result.content).toContainEqual({
      type: 'text',
      text: 'RSI(14) added; host returned no stable indicatorId.',
    });
    expect(execute).toHaveBeenCalledOnce();
    expect(recordIndicator).toHaveBeenCalledOnce();
    expect(recordIndicator).toHaveBeenCalledWith(
      { type: 'RSI', params: [14] }, identity, undefined,
    );
  });

  it('does not journal an explicit host rejection', async () => {
    execute.mockResolvedValueOnce({ success: false, error: 'policy denied' });
    const result = await client.callTool({
      name: 'romaco_add_indicator',
      arguments: { indicatorType: 'RSI', params: [14] },
    });

    expect(result.isError).toBe(true);
    expect(result.structuredContent).toMatchObject({
      status: 'error', error: { code: 'ACTION_DENIED' },
    });
    expect(recordIndicator).not.toHaveBeenCalled();
  });
});
