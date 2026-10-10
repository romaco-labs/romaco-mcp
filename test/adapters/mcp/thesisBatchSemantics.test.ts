import { describe, expect, it } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { registerThesisBatch } from '../../../src/adapters/inbound/mcp/tools/thesisBatch.js';
import type { AnalyzeBatchUseCase } from '../../../src/application/use-cases/analyzeBatch.js';
import { confidenceSemanticsFor } from '../../../src/domain/analysis/semantics.js';

describe('thesis batch score semantics', () => {
  it('never treats stored gateway confidence as calibrated without a validation contract', () => {
    expect(confidenceSemanticsFor('gateway')).toEqual({
      kind: 'unverified_provider_score',
      method: 'provider_unverified',
      version: null,
      calibrated: false,
      isProbability: false,
    });
  });

  it('labels ratio-weighted ranking as heuristic, not expectancy', async () => {
    const dataset = {
      datasetId: 'dataset_aapl', source: 'yfinance', symbol: 'AAPL', timeframe: '1d',
      candles: [], fetchedAt: 1,
    };
    const artifact = {
      analysisId: 'analysis_aapl', datasetId: 'dataset_aapl', provider: 'local',
      summary: {}, schemaVersion: 'thesis-v1', createdAt: 1,
      thesis: {
        bias: 'bullish', verdict: 'long', confidence: 0.8, bull: [], bear: [],
        setup: { entry: 100, stop: 95, target: 110, rr: 2, basis: 'fixture' },
        invalidation: { price: 95, reason: 'stop' }, horizon: 'swing', notes: [],
      },
    };
    const item = { dataset, artifact, score: 1.6 };
    const server = new McpServer({ name: 'batch-semantics-test', version: '0.0.0' });
    registerThesisBatch(server, {
      execute: async () => ({ items: [item], top: item, failures: [] }),
    } as unknown as AnalyzeBatchUseCase);
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await server.connect(serverTransport);
    const client = new Client({ name: 'batch-client', version: '0.0.0' }, { capabilities: {} });
    await client.connect(clientTransport);
    try {
      const result = await client.callTool({ name: 'romaco_thesis_batch', arguments: { symbols: ['AAPL'] } });
      expect(result.structuredContent).toMatchObject({
        status: 'ok',
        data: {
          scoreSemantics: {
            kind: 'heuristic_rank', method: 'setup_rr_times_confidence_v1', isExpectedReturn: false,
          },
          items: [{
            score: 1.6,
            confidenceSemantics: {
              kind: 'heuristic_evidence_score', isProbability: false,
            },
          }],
        },
      });
      expect(JSON.stringify(result.content)).toMatch(/score=1\.6000/);
      expect(JSON.stringify(result.content)).toMatch(/not win probabilities or expected returns/i);
    } finally {
      await client.close();
      await server.close();
    }
  });
});
