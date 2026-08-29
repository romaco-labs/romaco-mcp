import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { InMemoryAnalysisRepository } from '../../dist/adapters/outbound/persistence/InMemoryAnalysisRepository.js';
import { InMemoryDatasetRepository } from '../../dist/adapters/outbound/persistence/InMemoryDatasetRepository.js';
import { AnnotateThesisUseCase } from '../../dist/application/use-cases/annotateThesis.js';
import { LoadDatasetUseCase } from '../../dist/application/use-cases/loadDataset.js';
import { ResolveThesisArtifactUseCase } from '../../dist/application/use-cases/resolveThesisArtifact.js';
import { SetupChartUseCase } from '../../dist/application/use-cases/setupChart.js';
import { InMemoryApprovalStore } from '../../dist/adapters/outbound/security/InMemoryApprovalStore.js';
import { chartState } from '../../dist/chartState.js';
import { createServer } from '../../dist/server.js';
import { session } from '../../dist/session.js';
import { MemoryTelemetrySink } from './fake-ports.mjs';

class EvalActiveProjection {
  constructor() {
    this.active = null;
  }

  replace(dataset) {
    this.active = structuredClone(dataset);
    // Production uses LegacySessionProjection while legacy analysis/drawing
    // tools finish their port migration. Mirror that public runtime boundary so
    // offline trials exercise the same MCP-visible state, not a private shortcut.
    session.setLastLoad({
      source: dataset.source,
      symbol: dataset.symbol,
      timeframe: dataset.timeframe,
      candles: structuredClone(dataset.candles),
      fetched_at: dataset.fetchedAt,
    });
  }
}

class EvalPresetCatalog {
  constructor() {
    this.presets = new Map([
      ['clean', {
        name: 'clean',
        defaultTimeframe: '1d',
        lookback: 400,
        indicators: [],
      }],
      ['institutional', {
        name: 'institutional',
        defaultTimeframe: '1d',
        lookback: 400,
        indicators: [
          { type: 'EMA', params: [20] },
          { type: 'RSI', params: [14] },
        ],
      }],
    ]);
  }

  names() {
    return [...this.presets.keys()];
  }

  get(name) {
    const preset = this.presets.get(name);
    if (!preset) throw new Error(`Unknown eval preset: ${name}`);
    return structuredClone(preset);
  }
}

class EvalChartJournal {
  constructor() {
    this.indicators = [];
    this.groups = new Map();
  }

  recordIndicator(indicator, identity, resourceId) {
    this.indicators.push({ indicator: structuredClone(indicator), identity: structuredClone(identity), resourceId });
  }

  replaceDrawingGroup(groupId, drawings, identity, idempotencyKey, resourceIds) {
    this.groups.set(groupId, {
      drawings: structuredClone(drawings),
      identity: structuredClone(identity),
      idempotencyKey,
      resourceIds: structuredClone(resourceIds ?? []),
    });
  }
}

export function createEvalRuntime({ marketData, chart }) {
  session.clear();
  chartState.clear();
  let datasetCounter = 0;
  let analysisCounter = 0;
  const datasets = new InMemoryDatasetRepository(() => `eval_${++datasetCounter}`);
  const analyses = new InMemoryAnalysisRepository(() => `eval_${++analysisCounter}`);
  const projection = new EvalActiveProjection();
  const presets = new EvalPresetCatalog();
  const journal = new EvalChartJournal();
  const loadDataset = new LoadDatasetUseCase(marketData, datasets, analyses, projection);
  const resolveThesis = new ResolveThesisArtifactUseCase(
    datasets,
    analyses,
    { read: () => null },
    () => 1_788_000_000_000,
  );
  const setupChart = new SetupChartUseCase(loadDataset, chart, presets, journal);
  const annotateThesis = new AnnotateThesisUseCase(resolveThesis, datasets, chart, journal);
  let approvalCounter = 0;
  const approvals = new InMemoryApprovalStore({
    now: () => 1_788_000_000_000,
    createToken: () => `eval_approval_${String(++approvalCounter).padStart(48, '0')}`,
  });
  return {
    runtime: {
      datasets,
      analyses,
      loadDataset,
      chart,
      setupChart,
      presetNames: presets.names(),
      resolveThesis,
      annotateThesis,
      approvals,
    },
    projection,
    journal,
  };
}

export async function createEvalMcpHarness({ runtime }) {
  const telemetry = new MemoryTelemetrySink();
  const server = createServer(runtime, { telemetry });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  const client = new Client({ name: 'offline-eval', version: '1.0.0' }, { capabilities: {} });
  await client.connect(clientTransport);
  const calls = [];

  return {
    telemetry,
    calls,
    async callTool(name, args = {}) {
      const started = performance.now();
      const result = await client.callTool({ name, arguments: args });
      calls.push({
        name,
        args: structuredClone(args),
        result,
        durationMs: performance.now() - started,
        resultBytes: Buffer.byteLength(JSON.stringify(result), 'utf8'),
      });
      return result;
    },
    async close() {
      await client.close();
      await server.close();
    },
  };
}
