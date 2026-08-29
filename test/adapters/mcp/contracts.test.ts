import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { ApplicationError } from '../../../src/application/errors.js';
import {
  createTraceIdentifiers,
  registerContractTool,
} from '../../../src/adapters/inbound/mcp/contracts.js';
import type { ToolTelemetryEvent } from '../../../src/adapters/inbound/mcp/telemetry.js';

describe('MCP contract helper', () => {
  let server: McpServer;
  let client: Client;
  const events: ToolTelemetryEvent[] = [];

  beforeEach(async () => {
    events.length = 0;
    server = new McpServer({ name: 'contract-test', version: '0.0.0' });
    registerContractTool(
      server,
      {
        name: 'romaco_contract_test',
        title: 'Contract Test',
        description: 'Exercise strict dual MCP output.',
        inputSchema: z.object({ symbol: z.string().min(1) }),
        dataSchema: z.object({ echoedSymbol: z.string(), artifactId: z.string() }),
        annotations: {
          readOnlyHint: true,
          destructiveHint: false,
          idempotentHint: true,
          openWorldHint: false,
        },
        risk: { level: 'low', financial: false, approval: 'none' },
      },
      async ({ symbol }, context) => {
        context.recordDownstream({
          adapter: 'fake',
          operation: 'echo',
          durationMs: 1,
          outcome: 'ok',
        });
        if (symbol === 'FAIL') {
          throw new ApplicationError('DATASET_NOT_FOUND', 'Dataset missing.', {
            recovery: { action: 'load_dataset', instruction: 'Load candles first.' },
          });
        }
        return {
          data: { echoedSymbol: symbol, artifactId: 'artifact_1' },
          summary: `Echoed ${symbol}`,
          context: { symbol, datasetId: 'ds_1' },
        };
      },
      { telemetry: { record: (event) => events.push(event) } },
    );

    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await server.connect(serverTransport);
    client = new Client({ name: 'contract-client', version: '0.0.0' }, { capabilities: {} });
    await client.connect(clientTransport);
  });

  afterEach(async () => {
    await client.close();
    await server.close();
  });

  it('advertises title, strict output schema, annotations, and risk metadata', async () => {
    const listed = await client.listTools();
    const tool = listed.tools[0];
    expect(tool).toMatchObject({
      name: 'romaco_contract_test',
      title: 'Contract Test',
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
      _meta: {
        'io.romaco/contract': { version: '1' },
        'io.romaco/risk': { level: 'low', financial: false, approval: 'none' },
      },
    });
    expect(tool.outputSchema).toMatchObject({ type: 'object', additionalProperties: false });
    expect(tool.inputSchema).toMatchObject({ type: 'object', additionalProperties: false });
  });

  it('returns text plus validated structured content and trace metadata', async () => {
    const result = await client.callTool({
      name: 'romaco_contract_test',
      arguments: { symbol: 'AAPL' },
    });

    expect(result.isError).not.toBe(true);
    expect(result.content).toContainEqual({ type: 'text', text: 'Echoed AAPL' });
    expect(result.structuredContent).toEqual({
      status: 'ok',
      data: { echoedSymbol: 'AAPL', artifactId: 'artifact_1' },
      error: null,
      context: { symbol: 'AAPL', datasetId: 'ds_1' },
      warnings: [],
    });
    expect(result._meta?.['io.romaco/trace']).toMatchObject({
      traceId: expect.stringMatching(/^[0-9a-f]{32}$/),
      operationId: expect.any(String),
      requestId: expect.any(String),
    });
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      tool: 'romaco_contract_test',
      outcome: 'ok',
      input: { symbol: 'AAPL' },
    });
    expect(events[0].downstreamCalls).toHaveLength(1);
  });

  it('maps typed application errors into actionable structured errors', async () => {
    const result = await client.callTool({
      name: 'romaco_contract_test',
      arguments: { symbol: 'FAIL' },
    });

    expect(result.isError).toBe(true);
    expect(result.structuredContent).toEqual({
      status: 'error',
      data: null,
      error: {
        code: 'DATASET_NOT_FOUND',
        message: 'Dataset missing.',
        retryable: false,
        recovery: { action: 'load_dataset', instruction: 'Load candles first.' },
      },
      context: {},
      warnings: [],
    });
    expect(events.at(-1)).toMatchObject({ outcome: 'error', errorCode: 'DATASET_NOT_FOUND' });
  });

  it('rejects undeclared input properties before the handler', async () => {
    const result = await client.callTool({
      name: 'romaco_contract_test',
      arguments: { symbol: 'AAPL', surprise: true },
    });
    expect(result.isError).toBe(true);
    const text = (result.content as Array<{ type: string; text?: string }>)[0]?.text;
    expect(text).toMatch(/Input validation error/);
  });

  it('propagates a valid W3C trace id and rejects an all-zero trace id', () => {
    const propagated = createTraceIdentifiers('1', {
      traceparent: `00-${'a'.repeat(32)}-${'b'.repeat(16)}-01`,
    });
    const regenerated = createTraceIdentifiers('2', {
      traceparent: `00-${'0'.repeat(32)}-${'b'.repeat(16)}-01`,
    });
    expect(propagated.traceId).toBe('a'.repeat(32));
    expect(regenerated.traceId).toMatch(/^[0-9a-f]{32}$/);
    expect(regenerated.traceId).not.toBe('0'.repeat(32));
  });
});
