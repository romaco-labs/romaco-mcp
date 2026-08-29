import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createTestClient } from '../../tools/_client.js';
import { session } from '../../../src/session.js';
import { headShouldersCandles } from '../../compression/fixtures.js';

function rawCandles(count = 100) {
  return Array.from({ length: count }, (_, index) => ({
    timestamp: 1_700_000_000 + index * 3_600,
    open: 100 + index * 0.1,
    high: 101 + index * 0.1,
    low: 99 + index * 0.1,
    close: 100.5 + index * 0.1,
    volume: 1_000 + index,
  }));
}

type Harness = Awaited<ReturnType<typeof createTestClient>>;

describe('hex-migrated MCP output contracts', () => {
  let harness: Harness;

  beforeEach(async () => {
    session.clear();
    harness = await createTestClient();
  });

  afterEach(async () => {
    session.clear();
    await harness.close();
  });

  it('returns a structured, deterministic position-size calculation id', async () => {
    const response = await harness.callTool('romaco_calculate_position_size', {
      accountSize: 10_000,
      riskPct: 1,
      entryPrice: 100,
      stopLoss: 98,
      targetPrice: 106,
      commissionPerSide: 1,
    });
    expect(response.isError).toBe(false);
    expect(JSON.parse(response.text)).toMatchObject({ side: 'long', shares: 49 });
    expect(response.raw.structuredContent).toMatchObject({
      status: 'ok',
      data: {
        calculationId: expect.stringMatching(/^calculation_[0-9a-f]{20}$/),
        side: 'long',
        shares: 49,
        maxDollarRisk: 100,
        actualDollarRisk: 100,
      },
      error: null,
    });
  });

  it('rejects calculations that exceed JSON-safe financial ranges', async () => {
    const response = await harness.callTool('romaco_calculate_position_size', {
      accountSize: 1e308,
      riskPct: 10,
      entryPrice: 1e150,
      stopLoss: 1e150 - 1e140,
    });
    expect(response.isError).toBe(true);
    expect(response.raw.structuredContent).toMatchObject({
      status: 'error',
      error: { code: 'INVALID_ARGUMENT' },
    });
    expect(JSON.stringify(response.raw)).not.toMatch(/"(positionValue|positionPctOfAccount)":null/);
  });

  it('returns datasetId and compact dataset metadata without raw candles', async () => {
    const response = await harness.callTool('romaco_load_candles', {
      source: 'raw',
      symbol: ' aapl ',
      timeframe: '1h',
      rawCandles: rawCandles(),
    });
    const structured = response.raw.structuredContent as Record<string, any>;
    expect(response.text).toMatch(/datasetId=dataset_/);
    expect(structured).toMatchObject({
      status: 'ok',
      data: {
        dataset: {
          datasetId: expect.stringMatching(/^dataset_/),
          symbol: 'AAPL',
          timeframe: '1h',
          source: 'raw',
          candleCount: 100,
        },
      },
      context: {
        datasetId: expect.stringMatching(/^dataset_/),
        symbol: 'AAPL',
        timeframe: '1h',
      },
    });
    expect(JSON.stringify(structured)).not.toContain('rawCandles');
    expect(structured.data.dataset.candles).toBeUndefined();
  });

  it('returns a stable thesis artifact and provider while preserving disclaimer text', async () => {
    await harness.callTool('romaco_load_candles', {
      source: 'raw',
      symbol: 'TEST',
      timeframe: '1h',
      rawCandles: rawCandles(120),
    });
    const response = await harness.callTool('romaco_thesis');
    expect(response.text).toContain('⚠️ Not investment advice');
    expect(response.raw.structuredContent).toMatchObject({
      status: 'ok',
      data: {
        analysisId: expect.stringMatching(/^analysis_/),
        datasetId: expect.stringMatching(/^dataset_/),
        provider: 'local',
        thesis: { verdict: expect.any(String) },
      },
      context: {
        datasetId: expect.stringMatching(/^dataset_/),
        analysisId: expect.stringMatching(/^analysis_/),
      },
    });
  });

  it('gates exact pattern anchors while preserving one analysis artifact', async () => {
    await harness.callTool('romaco_load_candles', {
      source: 'raw',
      symbol: 'AAPL',
      timeframe: '1h',
      rawCandles: headShouldersCandles(),
    });
    const concise = await harness.callTool('romaco_detect_patterns');
    const full = await harness.callTool('romaco_detect_patterns', {
      acknowledgeHighTokenCost: true,
    });
    const conciseData = (concise.raw.structuredContent as any).data;
    const fullData = (full.raw.structuredContent as any).data;

    expect(conciseData).toMatchObject({
      format: 'concise',
      count: expect.any(Number),
      datasetId: expect.stringMatching(/^dataset_/),
      analysisId: expect.stringMatching(/^analysis_/),
    });
    expect(fullData).toMatchObject({
      format: 'full',
      count: conciseData.count,
      datasetId: conciseData.datasetId,
      analysisId: conciseData.analysisId,
    });
    expect(conciseData.patterns.every((pattern: any) => pattern.points === undefined)).toBe(true);
    expect(fullData.patterns.every((pattern: any) => Array.isArray(pattern.points))).toBe(true);
  });

  it('retrieves an exact prior thesis by public analysisId without changing current state', async () => {
    await harness.callTool('romaco_load_candles', {
      source: 'raw', symbol: 'AAPL', timeframe: '1h', rawCandles: rawCandles(120),
    });
    const a = await harness.callTool('romaco_thesis');
    const aData = (a.raw.structuredContent as any).data;
    await harness.callTool('romaco_load_candles', {
      source: 'raw', symbol: 'TSLA', timeframe: '1h', rawCandles: rawCandles(120),
    });
    const b = await harness.callTool('romaco_thesis');
    const bData = (b.raw.structuredContent as any).data;

    const exactA = await harness.callTool('romaco_thesis', { analysisId: aData.analysisId });
    expect(exactA.raw.structuredContent).toMatchObject({
      status: 'ok',
      data: { analysisId: aData.analysisId, datasetId: aData.datasetId },
    });
    const currentB = await harness.callTool('romaco_thesis');
    expect(currentB.raw.structuredContent).toMatchObject({
      data: { analysisId: bData.analysisId, datasetId: bData.datasetId },
    });
  });

  it('returns setup identity, provider, live status, and resource ids', async () => {
    const response = await harness.callTool('romaco_setup_chart', {
      symbol: 'TEST',
      preset: 'clean',
      timeframe: '1h',
      source: 'raw',
      rawCandles: rawCandles(100),
    });
    expect(response.text).toMatch(/datasetId=dataset_/);
    expect(response.text).toMatch(/analysisId=analysis_/);
    expect(response.raw.structuredContent).toMatchObject({
      status: 'ok',
      data: {
        dataset: { datasetId: expect.stringMatching(/^dataset_/) },
        analysisId: expect.stringMatching(/^analysis_/),
        provider: 'local',
        preset: { name: 'clean', liveStatus: 'clean', chartId: null, indicators: [] },
        resourceIds: [],
      },
    });
  });

  it('advertises outputSchema for every migrated headless tool', async () => {
    const tools = await harness.client.listTools();
    for (const name of [
      'romaco_calculate_position_size',
      'romaco_load_candles',
      'romaco_setup_chart',
      'romaco_thesis',
      'romaco_detect_patterns',
    ]) {
      expect(tools.tools.find((tool) => tool.name === name)?.outputSchema).toMatchObject({
        type: 'object',
        additionalProperties: false,
      });
    }
  });
});
