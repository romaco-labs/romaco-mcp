import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { AddDrawingUseCase } from '../../../src/application/use-cases/addDrawing.js';
import type { ChartPort } from '../../../src/application/ports/chart.js';
import { createChartId } from '../../../src/domain/chart/model.js';
import { registerAddDrawing } from '../../../src/adapters/inbound/mcp/tools/addDrawing.js';

const identity = {
  chartId: createChartId('chart_aapl'),
  symbol: 'AAPL',
  timeframe: '1d' as const,
};

describe('romaco_add_drawing structured contract', () => {
  let server: McpServer;
  let client: Client;
  let chart: ChartPort;
  let execute: ReturnType<typeof vi.fn>;
  let recordDrawing: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    execute = vi.fn(async () => ({ success: true, resourceIds: ['drawing_fib_1'] }));
    recordDrawing = vi.fn();
    chart = {
      isConnected: () => true,
      getIdentity: vi.fn(async () => identity),
      getContext: vi.fn(),
      execute,
      replaceDrawingGroup: vi.fn(),
      captureSnapshot: vi.fn(),
    };
    const useCase = new AddDrawingUseCase(chart, {
      findByName: (name) => name.toLowerCase() === 'fibretracement'
        ? { name: 'fibRetracement', pointCount: 2 }
        : undefined,
    }, { recordDrawing });
    server = new McpServer({ name: 'add-drawing-contract-test', version: '0.0.0' });
    registerAddDrawing(server, useCase);
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await server.connect(serverTransport);
    client = new Client({ name: 'live-client', version: '0.0.0' }, { capabilities: {} });
    await client.connect(clientTransport);
  });

  afterEach(async () => {
    await client.close();
    await server.close();
  });

  it('returns host drawingId and exact chart identity', async () => {
    const result = await client.callTool({
      name: 'romaco_add_drawing',
      arguments: {
        drawingType: 'fibRetracement',
        points: [{ timestamp: 1, price: 100 }, { timestamp: 2, price: 120 }],
      },
    });

    expect(result.isError).not.toBe(true);
    expect(result.structuredContent).toMatchObject({
      status: 'ok',
      data: {
        drawingId: 'drawing_fib_1',
        applied: true,
        drawing: {
          id: 'drawing_fib_1', type: 'fibRetracement', pointCount: 2, groupId: 'romaco-mcp/manual',
        },
        identity,
      },
      context: identity,
      warnings: [],
    });
    expect(result.content).toContainEqual({ type: 'text', text: 'fibRetracement drawn on chart' });
    expect(execute).toHaveBeenCalledOnce();
    expect(recordDrawing).toHaveBeenCalledOnce();
  });

  it('returns typed recovery and sends zero writes for wrong anchor count', async () => {
    const result = await client.callTool({
      name: 'romaco_add_drawing',
      arguments: {
        drawingType: 'fibRetracement',
        points: [{ timestamp: 1, price: 100 }],
      },
    });

    expect(result.isError).toBe(true);
    expect(result.structuredContent).toMatchObject({
      status: 'error',
      error: {
        code: 'INVALID_ARGUMENT',
        recovery: {
          action: 'change_input',
          parameters: {
            drawingType: 'fibRetracement',
            expectedPointCount: 2,
            actualPointCount: 1,
          },
        },
      },
    });
    expect(chart.getIdentity).not.toHaveBeenCalled();
    expect(execute).not.toHaveBeenCalled();
    expect(recordDrawing).not.toHaveBeenCalled();
  });

  it('rejects a user-owned group namespace with typed recovery and zero writes', async () => {
    const result = await client.callTool({
      name: 'romaco_add_drawing',
      arguments: {
        drawingType: 'fibRetracement',
        points: [{ timestamp: 1, price: 100 }, { timestamp: 2, price: 120 }],
        groupId: 'user/portfolio-notes',
      },
    });

    expect(result.structuredContent).toMatchObject({
      status: 'error',
      error: {
        code: 'INVALID_ARGUMENT',
        recovery: { action: 'change_input' },
      },
    });
    expect(chart.getIdentity).not.toHaveBeenCalled();
    expect(execute).not.toHaveBeenCalled();
    expect(recordDrawing).not.toHaveBeenCalled();
  });

  it('advertises strict output schema and reports legacy host missing drawingId honestly', async () => {
    execute.mockResolvedValueOnce({ success: true });
    const tools = await client.listTools();
    expect(tools.tools.find((tool) => tool.name === 'romaco_add_drawing')?.outputSchema).toMatchObject({
      type: 'object',
      additionalProperties: false,
    });

    const result = await client.callTool({
      name: 'romaco_add_drawing',
      arguments: {
        drawingType: 'fibRetracement',
        points: [{ timestamp: 1, price: 100 }, { timestamp: 2, price: 120 }],
      },
    });
    expect(result.structuredContent).toMatchObject({
      status: 'partial',
      data: { drawingId: null, drawing: { id: null } },
      warnings: [{ code: 'RESOURCE_ID_UNAVAILABLE' }],
    });
  });
});
