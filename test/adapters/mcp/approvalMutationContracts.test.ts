import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createServer } from '../../../src/server.js';
import { createProductionRuntime } from '../../../src/bootstrap/runtime.js';
import { bridge } from '../../../src/bridge.js';
import { chartState } from '../../../src/chartState.js';
import { createChartId } from '../../../src/domain/chart/model.js';

const identity = { chartId: createChartId('primary'), symbol: 'AAPL', timeframe: '1d' as const };

async function clientFixture() {
  const server = createServer(createProductionRuntime());
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  const client = new Client({ name: 'approval-contract-test', version: '0.0.0' }, { capabilities: {} });
  await client.connect(clientTransport);
  return { client, close: async () => { await client.close(); await server.close(); } };
}

function structured(result: Awaited<ReturnType<Client['callTool']>>): any {
  return result.structuredContent as any;
}

beforeEach(() => {
  vi.spyOn(bridge, 'chartId', 'get').mockReturnValue('primary');
  vi.spyOn(bridge, 'getContext').mockResolvedValue({ symbol: 'AAPL', resolution: '1d' });
  vi.spyOn(bridge, 'executeAction').mockResolvedValue({
    success: true,
    data: { positionId: 'host-paper-1', drawingIds: [] },
  });
});

afterEach(() => {
  chartState.clear();
  vi.restoreAllMocks();
});

describe('approval-gated chart mutation contracts', () => {
  it('previews clear scope with zero writes, then removes only exact Romaco groups', async () => {
    chartState.replaceDrawingGroup({
      action: 'replaceAgentDrawingGroup',
      groupId: 'romaco-mcp/thesis',
      idempotencyKey: 'thesis-1',
      expectedIdentity: { chartId: 'primary', symbol: 'AAPL', resolution: '1d' },
      drawings: [{ drawingType: 'horizontalLine', points: [{ timestamp: 1, price: 100 }] }],
    }, identity);
    chartState.recordDrawing({
      action: 'addDrawing',
      drawingType: 'trendline',
      groupId: 'user/group',
      points: [{ timestamp: 1, price: 100 }, { timestamp: 2, price: 101 }],
    }, identity);
    const { client, close } = await clientFixture();
    try {
      const preview = await client.callTool({ name: 'romaco_clear_drawings', arguments: {} });
      expect(structured(preview)).toMatchObject({
        status: 'error',
        error: {
          code: 'APPROVAL_REQUIRED',
          recovery: { parameters: { groupIds: ['romaco-mcp/thesis'], drawingCount: 1 } },
        },
      });
      expect(bridge.executeAction).not.toHaveBeenCalled();

      const parameters = structured(preview).error.recovery.parameters;
      const applied = await client.callTool({
        name: 'romaco_clear_drawings',
        arguments: { planId: parameters.planId, approvalToken: parameters.approvalToken },
      });
      expect(structured(applied)).toMatchObject({
        status: 'ok',
        data: {
          chartId: 'primary',
          symbol: 'AAPL',
          timeframe: '1d',
          groupIds: ['romaco-mcp/thesis'],
          removedCount: 1,
          scope: 'romaco-agent-groups',
        },
      });
      expect(bridge.executeAction).toHaveBeenCalledTimes(1);
      expect(bridge.executeAction).toHaveBeenCalledWith(expect.objectContaining({
        action: 'replaceAgentDrawingGroup',
        groupId: 'romaco-mcp/thesis',
        drawings: [],
        expectedIdentity: { chartId: 'primary', symbol: 'AAPL', resolution: '1d' },
      }));
      expect(chartState.snapshot().drawingGroups).toHaveLength(0);
      expect(chartState.snapshot().drawings).toHaveLength(1);
      expect(chartState.snapshot().drawings[0].action).toMatchObject({ groupId: 'user/group' });
    } finally {
      await close();
    }
  });

  it('rejects stale clear plan and consumes token without a chart write', async () => {
    chartState.replaceDrawingGroup({
      action: 'replaceAgentDrawingGroup', groupId: 'romaco-mcp/thesis', idempotencyKey: 'one',
      expectedIdentity: { chartId: 'primary', symbol: 'AAPL', resolution: '1d' }, drawings: [],
    }, identity);
    const { client, close } = await clientFixture();
    try {
      const preview = await client.callTool({ name: 'romaco_clear_drawings', arguments: {} });
      const parameters = structured(preview).error.recovery.parameters;
      chartState.replaceDrawingGroup({
        action: 'replaceAgentDrawingGroup', groupId: 'romaco-mcp/new', idempotencyKey: 'two',
        expectedIdentity: { chartId: 'primary', symbol: 'AAPL', resolution: '1d' }, drawings: [],
      }, identity);

      const stale = await client.callTool({
        name: 'romaco_clear_drawings',
        arguments: { planId: parameters.planId, approvalToken: parameters.approvalToken },
      });
      expect(structured(stale)).toMatchObject({ status: 'error', error: { code: 'APPROVAL_INVALID' } });
      expect(bridge.executeAction).not.toHaveBeenCalled();

      const replay = await client.callTool({
        name: 'romaco_clear_drawings',
        arguments: { planId: parameters.planId, approvalToken: parameters.approvalToken },
      });
      expect(structured(replay)).toMatchObject({ status: 'error', error: { code: 'APPROVAL_INVALID' } });
      expect(bridge.executeAction).not.toHaveBeenCalled();
    } finally {
      await close();
    }
  });

  it('opens paper position only after scoped approval, then replays exact receipt', async () => {
    const { client, close } = await clientFixture();
    const input = {
      side: 'long', quantity: 2, stopLoss: 145, takeProfit: 160, idempotencyKey: 'paper-aapl-1',
    };
    try {
      const challenge = await client.callTool({ name: 'romaco_open_paper_position', arguments: input });
      expect(structured(challenge)).toMatchObject({
        status: 'error',
        error: {
          code: 'APPROVAL_REQUIRED',
          recovery: { parameters: { mode: 'paper', chartId: 'primary', ...input } },
        },
      });
      expect(bridge.executeAction).not.toHaveBeenCalled();
      const approvalToken = structured(challenge).error.recovery.parameters.approvalToken;

      const applied = await client.callTool({
        name: 'romaco_open_paper_position',
        arguments: { ...input, approvalToken },
      });
      expect(structured(applied)).toMatchObject({
        status: 'ok',
        data: {
          chartId: 'primary', symbol: 'AAPL', timeframe: '1d',
          position: {
            mode: 'paper', side: 'long', quantity: 2, stopLoss: 145, takeProfit: 160,
            hostPositionId: 'host-paper-1',
          },
          idempotencyKey: 'paper-aapl-1',
          replayed: false,
        },
      });
      expect(bridge.executeAction).toHaveBeenCalledTimes(1);
      expect(bridge.executeAction).toHaveBeenCalledWith(expect.objectContaining({
        action: 'openPaperLong',
        quantity: 2,
        expectedIdentity: { chartId: 'primary', symbol: 'AAPL', resolution: '1d' },
      }));

      const replay = await client.callTool({ name: 'romaco_open_paper_position', arguments: input });
      expect(structured(replay)).toMatchObject({
        status: 'noop',
        data: { position: structured(applied).data.position, idempotencyKey: 'paper-aapl-1', replayed: true },
      });
      expect(bridge.executeAction).toHaveBeenCalledTimes(1);
    } finally {
      await close();
    }
  });

  it('denies changed payload for completed key and approval token cannot cross payload scope', async () => {
    const { client, close } = await clientFixture();
    const original = { side: 'short', quantity: 1, idempotencyKey: 'paper-scope-1' };
    try {
      const challenge = await client.callTool({ name: 'romaco_open_paper_position', arguments: original });
      const approvalToken = structured(challenge).error.recovery.parameters.approvalToken;
      const wrongScope = await client.callTool({
        name: 'romaco_open_paper_position',
        arguments: { ...original, quantity: 2, approvalToken },
      });
      expect(structured(wrongScope)).toMatchObject({ status: 'error', error: { code: 'APPROVAL_INVALID' } });
      expect(bridge.executeAction).not.toHaveBeenCalled();

      const fresh = await client.callTool({ name: 'romaco_open_paper_position', arguments: original });
      const freshToken = structured(fresh).error.recovery.parameters.approvalToken;
      await client.callTool({
        name: 'romaco_open_paper_position',
        arguments: { ...original, approvalToken: freshToken },
      });
      const conflict = await client.callTool({
        name: 'romaco_open_paper_position',
        arguments: { ...original, quantity: 2 },
      });
      expect(structured(conflict)).toMatchObject({
        status: 'error', error: { code: 'IDEMPOTENCY_CONFLICT' },
      });
      expect(bridge.executeAction).toHaveBeenCalledTimes(1);
    } finally {
      await close();
    }
  });

  it('blocks automatic paper retry after ambiguous host failure', async () => {
    vi.mocked(bridge.executeAction).mockRejectedValueOnce(new Error('response lost'));
    const { client, close } = await clientFixture();
    const input = { side: 'long', quantity: 1, idempotencyKey: 'paper-indeterminate-1' };
    try {
      const challenge = await client.callTool({ name: 'romaco_open_paper_position', arguments: input });
      const approvalToken = structured(challenge).error.recovery.parameters.approvalToken;
      const failed = await client.callTool({
        name: 'romaco_open_paper_position',
        arguments: { ...input, approvalToken },
      });
      expect(structured(failed)).toMatchObject({
        status: 'error',
        error: { code: 'ACTION_DENIED', retryable: false, recovery: { action: 'change_input' } },
      });

      const retry = await client.callTool({ name: 'romaco_open_paper_position', arguments: input });
      expect(structured(retry)).toMatchObject({
        status: 'error',
        error: { code: 'ACTION_DENIED', retryable: false },
      });
      expect(structured(retry).error.message).toMatch(/indeterminate/i);
      expect(bridge.executeAction).toHaveBeenCalledTimes(1);
    } finally {
      await close();
    }
  });
});
