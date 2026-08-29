import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { registerClearAlerts } from '../../../src/adapters/inbound/mcp/tools/clearAlerts.js';
import { InMemoryApprovalStore } from '../../../src/adapters/outbound/security/InMemoryApprovalStore.js';
import type { ChartPort } from '../../../src/application/ports/chart.js';
import { ClearAlertsUseCase } from '../../../src/application/use-cases/clearAlerts.js';
import { createChartId, type ChartAlertState } from '../../../src/domain/chart/model.js';

const identity = {
  chartId: createChartId('chart-aapl'), symbol: 'AAPL', timeframe: '1d' as const,
};

describe('romaco_clear_alerts structured approval contract', () => {
  let server: McpServer;
  let client: Client;
  let alerts: ChartAlertState[];
  let execute: ReturnType<typeof vi.fn>;
  let removeAlert: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    alerts = [
      { id: 'alert-2', price: 160, direction: 'above' },
      { id: 'alert-1', price: 140, direction: 'below' },
    ];
    execute = vi.fn(async (command: { action: string; alertId?: string }) => {
      if (command.action === 'removeAlert') {
        alerts = alerts.filter((alert) => alert.id !== command.alertId);
      }
      return { success: true };
    });
    removeAlert = vi.fn();
    const chart: ChartPort = {
      isConnected: () => true,
      getIdentity: vi.fn(async () => identity),
      getContext: vi.fn(async () => ({ identity, totalCandles: 300, alerts: structuredClone(alerts) })),
      execute,
      replaceDrawingGroup: vi.fn(),
      captureSnapshot: vi.fn(),
    };
    server = new McpServer({ name: 'clear-alerts-contract-test', version: '0.0.0' });
    registerClearAlerts(
      server,
      new ClearAlertsUseCase(chart, { removeAlert }),
      new InMemoryApprovalStore({ createToken: () => 'approval_'.padEnd(43, 'a') }),
    );
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await server.connect(serverTransport);
    client = new Client({ name: 'test-client', version: '0.0.0' }, { capabilities: {} });
    await client.connect(clientTransport);
  });

  afterEach(async () => {
    await client.close();
    await server.close();
  });

  function structured(result: Awaited<ReturnType<Client['callTool']>>): any {
    return result.structuredContent as any;
  }

  it('previews with zero writes, removes exact IDs once, and rejects token replay', async () => {
    const tools = await client.listTools();
    expect(tools.tools.find((tool) => tool.name === 'romaco_clear_alerts')).toMatchObject({
      outputSchema: { type: 'object', additionalProperties: false },
      _meta: { 'io.romaco/risk': { approval: 'confirmation-token' } },
    });

    const preview = await client.callTool({ name: 'romaco_clear_alerts', arguments: {} });
    expect(structured(preview)).toMatchObject({
      status: 'error',
      error: {
        code: 'APPROVAL_REQUIRED',
        recovery: {
          parameters: {
            chartId: 'chart-aapl',
            symbol: 'AAPL',
            timeframe: '1d',
            alertCount: 2,
            scope: 'current-chart-alerts',
          },
        },
      },
    });
    expect(execute).not.toHaveBeenCalled();
    const parameters = structured(preview).error.recovery.parameters;

    const applied = await client.callTool({
      name: 'romaco_clear_alerts',
      arguments: { planId: parameters.planId, approvalToken: parameters.approvalToken },
    });
    expect(structured(applied)).toMatchObject({
      status: 'ok',
      data: {
        chartId: 'chart-aapl',
        symbol: 'AAPL',
        timeframe: '1d',
        alertIds: ['alert-1', 'alert-2'],
        removedCount: 2,
        scope: 'current-chart-alerts',
      },
    });
    expect(execute).toHaveBeenCalledTimes(2);
    expect(execute.mock.calls.every(([command]) => command.action === 'removeAlert')).toBe(true);
    expect(execute.mock.calls.map(([, options]) => options)).toEqual([
      { expectedIdentity: identity },
      { expectedIdentity: identity },
    ]);
    expect(removeAlert).toHaveBeenCalledTimes(2);

    const replay = await client.callTool({
      name: 'romaco_clear_alerts',
      arguments: { planId: parameters.planId, approvalToken: parameters.approvalToken },
    });
    expect(structured(replay)).toMatchObject({
      status: 'error', error: { code: 'APPROVAL_INVALID' },
    });
    expect(execute).toHaveBeenCalledTimes(2);
  });

  it('consumes a stale approval and sends zero writes after alert-plan drift', async () => {
    const preview = await client.callTool({ name: 'romaco_clear_alerts', arguments: {} });
    const parameters = structured(preview).error.recovery.parameters;
    alerts.push({ id: 'alert-new', price: 170, direction: 'cross' });

    const stale = await client.callTool({
      name: 'romaco_clear_alerts',
      arguments: { planId: parameters.planId, approvalToken: parameters.approvalToken },
    });
    expect(structured(stale)).toMatchObject({
      status: 'error', error: { code: 'APPROVAL_INVALID' },
    });
    expect(execute).not.toHaveBeenCalled();
  });
});
