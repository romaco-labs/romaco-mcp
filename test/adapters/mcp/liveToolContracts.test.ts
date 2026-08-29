import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { registerAnnotate } from '../../../src/adapters/inbound/mcp/tools/annotateThesis.js';
import { registerGetChartContext } from '../../../src/adapters/inbound/mcp/tools/getChartContext.js';
import { registerListPanes } from '../../../src/adapters/inbound/mcp/tools/listPanes.js';
import type { AnnotateThesisUseCase } from '../../../src/application/use-cases/annotateThesis.js';
import type { ChartPort } from '../../../src/application/ports/chart.js';
import { createAnalysisId } from '../../../src/domain/analysis/model.js';
import { createChartId } from '../../../src/domain/chart/model.js';
import { createDatasetId } from '../../../src/domain/dataset/model.js';

const identity = {
  chartId: createChartId('chart_aapl'),
  symbol: 'AAPL',
  timeframe: '1d' as const,
  datasetId: createDatasetId('dataset_aapl'),
};

function chart(): ChartPort {
  return {
    isConnected: () => true,
    getIdentity: async () => identity,
    getContext: async () => ({
      identity,
      raw: {
        symbol: 'AAPL',
        resolution: '1d',
        currentPrice: 150,
        totalCandles: 400,
        existingIndicators: [],
        existingDrawings: [],
        panels: [],
      },
    }),
    execute: async (command) => command.action === 'listPanes'
      ? { success: true, data: { panes: [{ id: 'main', alias: 'main', indicators: [] }] } }
      : { success: true },
    replaceDrawingGroup: async () => ({ success: true }),
    captureSnapshot: async (format) => ({ format, dataUrl: 'data:image/png;base64,ZmFrZQ==' }),
  };
}

describe('live hex MCP output contracts', () => {
  let server: McpServer;
  let client: Client;

  beforeEach(async () => {
    server = new McpServer({ name: 'live-contract-test', version: '0.0.0' });
    const chartPort = chart();
    registerGetChartContext(server, chartPort);
    registerListPanes(server, chartPort);
    registerAnnotate(server, {
      execute: async () => ({
        artifact: {
          analysisId: createAnalysisId('analysis_aapl'),
          datasetId: identity.datasetId,
          provider: 'local',
          summary: {},
          thesis: {
            bias: 'bullish',
            verdict: 'long',
            confidence: 0.8,
            bull: [],
            bear: [],
            setup: { entry: 150, stop: 145, target: 160, rr: 2, basis: 'fixture' },
            invalidation: { price: 145, reason: 'stop' },
            horizon: 'position',
            notes: [],
          },
          schemaVersion: 'thesis-v1',
          createdAt: 1,
        },
        dataset: {
          datasetId: identity.datasetId,
          source: 'raw',
          symbol: 'AAPL',
          timeframe: '1d',
          candles: [],
          fetchedAt: 1,
        },
        chartIdentity: identity,
        groupId: 'romaco-mcp/thesis',
        drawings: [{ action: 'addDrawing', drawingType: 'horizontalLine', points: [] }, {
          action: 'addDrawing', drawingType: 'longPosition', points: [],
        }],
        resourceIds: ['drawing_1', 'drawing_2'],
        idempotencyKey: 'idem_1',
      }),
    } as unknown as AnnotateThesisUseCase);

    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await server.connect(serverTransport);
    client = new Client({ name: 'live-client', version: '0.0.0' }, { capabilities: {} });
    await client.connect(clientTransport);
  });

  afterEach(async () => {
    await client.close();
    await server.close();
  });

  it('returns canonical chart identity with concise chart context', async () => {
    const result = await client.callTool({ name: 'romaco_get_chart_context', arguments: {} });
    expect(result.structuredContent).toMatchObject({
      status: 'ok',
      data: {
        format: 'concise',
        chartId: 'chart_aapl',
        identity: {
          chartId: 'chart_aapl',
          symbol: 'AAPL',
          timeframe: '1d',
          datasetId: 'dataset_aapl',
        },
        context: { lastPrice: 150, totalCandles: 400 },
      },
      context: {
        chartId: 'chart_aapl',
        datasetId: 'dataset_aapl',
      },
    });
  });

  it('returns chartId with validated pane records', async () => {
    const result = await client.callTool({ name: 'romaco_list_panes', arguments: {} });
    expect(result.structuredContent).toMatchObject({
      status: 'ok',
      data: { chartId: 'chart_aapl', panes: [{ id: 'main', alias: 'main' }] },
    });
  });

  it('returns analysis/chart/resource identities for an atomic annotation', async () => {
    const result = await client.callTool({
      name: 'romaco_annotate',
      arguments: { analysisId: 'analysis_aapl' },
    });
    expect(result.structuredContent).toMatchObject({
      status: 'ok',
      data: {
        analysisId: 'analysis_aapl',
        datasetId: 'dataset_aapl',
        chartId: 'chart_aapl',
        provider: 'local',
        verdict: 'long',
        groupId: 'romaco-mcp/thesis',
        drawingIds: ['drawing_1', 'drawing_2'],
        drawingCount: 2,
        scope: 'trade',
        idempotencyKey: 'idem_1',
      },
    });
  });

  it('advertises strict output schemas for all migrated live tools', async () => {
    const tools = await client.listTools();
    for (const name of ['romaco_get_chart_context', 'romaco_list_panes', 'romaco_annotate']) {
      expect(tools.tools.find((tool) => tool.name === name)?.outputSchema).toMatchObject({
        type: 'object',
        additionalProperties: false,
      });
    }
  });
});
