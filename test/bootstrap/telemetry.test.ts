import { afterEach, describe, expect, it } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createConfiguredToolTelemetrySink } from '../../src/bootstrap/telemetry.js';
import { createProductionRuntime } from '../../src/bootstrap/runtime.js';
import { createServer } from '../../src/server.js';
import type { ToolTelemetryEvent } from '../../src/adapters/inbound/mcp/telemetry.js';

describe('explicit local MCP telemetry configuration', () => {
  const clients: Client[] = [];

  afterEach(async () => {
    await Promise.all(clients.splice(0).map((client) => client.close()));
  });

  it('stays disabled for absent, false-like, or unknown modes', () => {
    expect(createConfiguredToolTelemetrySink({ env: {} })).toBeUndefined();
    expect(createConfiguredToolTelemetrySink({ env: { ROMACO_MCP_TELEMETRY: 'off' } })).toBeUndefined();
    expect(createConfiguredToolTelemetrySink({ env: { ROMACO_MCP_TELEMETRY: 'https' } })).toBeUndefined();
  });

  it('writes redacted JSONL only after explicit jsonl opt-in', async () => {
    const lines: string[] = [];
    const sink = createConfiguredToolTelemetrySink({
      env: { ROMACO_MCP_TELEMETRY: 'jsonl' },
      writeLine: (line) => lines.push(line),
    });
    expect(sink).toBeTruthy();
    await sink!.record({
      schemaVersion: 1,
      event: 'mcp.tool',
      traceId: 'a'.repeat(32),
      operationId: 'operation_1',
      requestId: 'request_1',
      tool: 'romaco_test',
      startedAt: '2026-08-29T00:00:00.000Z',
      durationMs: 1,
      outcome: 'ok',
      input: { token: '[REDACTED]' },
      downstreamCalls: [],
    });
    expect(lines).toHaveLength(1);
    expect(lines[0].endsWith('\n')).toBe(true);
    expect(JSON.parse(lines[0])).toMatchObject({ event: 'mcp.tool', tool: 'romaco_test' });
  });

  it('wires an explicit sink into contract-migrated production registrations', async () => {
    const events: ToolTelemetryEvent[] = [];
    const server = createServer(createProductionRuntime(), {
      telemetry: { record: (event) => events.push(event) },
    });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await server.connect(serverTransport);
    const client = new Client({ name: 'telemetry-client', version: '0.0.0' }, { capabilities: {} });
    clients.push(client);
    await client.connect(clientTransport);

    await client.callTool({
      name: 'romaco_calculate_position_size',
      arguments: { accountSize: 10_000, riskPct: 1, entryPrice: 100, stopLoss: 98 },
    });
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      event: 'mcp.tool',
      tool: 'romaco_calculate_position_size',
      outcome: 'ok',
      input: { accountSize: 10_000, riskPct: 1, entryPrice: 100, stopLoss: 98 },
    });
    await server.close();
  });
});
