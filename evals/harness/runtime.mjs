import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { InMemoryAnalysisRepository } from '../../dist/adapters/outbound/persistence/InMemoryAnalysisRepository.js';
import { InMemoryDatasetRepository } from '../../dist/adapters/outbound/persistence/InMemoryDatasetRepository.js';
import { AnnotateThesisUseCase } from '../../dist/application/use-cases/annotateThesis.js';
import { AnalyzeBatchUseCase } from '../../dist/application/use-cases/analyzeBatch.js';
import { AddDrawingUseCase } from '../../dist/application/use-cases/addDrawing.js';
import { ClearAgentDrawingsUseCase } from '../../dist/application/use-cases/clearAgentDrawings.js';
import { OpenPaperPositionUseCase } from '../../dist/application/use-cases/openPaperPosition.js';
import { ReconcileChartStateUseCase } from '../../dist/application/use-cases/reconcileChartState.js';
import { LoadDatasetUseCase } from '../../dist/application/use-cases/loadDataset.js';
import { ResolveThesisArtifactUseCase } from '../../dist/application/use-cases/resolveThesisArtifact.js';
import { SetupChartUseCase } from '../../dist/application/use-cases/setupChart.js';
import { SerializedActiveSessionActivation } from '../../dist/application/use-cases/serializedActiveSessionActivation.js';
import { InMemoryApprovalStore } from '../../dist/adapters/outbound/security/InMemoryApprovalStore.js';
import { InMemoryPaperPositionIdempotencyStore } from '../../dist/adapters/outbound/persistence/InMemoryPaperPositionIdempotencyStore.js';
import { chartState } from '../../dist/chartState.js';
import { createServer } from '../../dist/server.js';
import { session } from '../../dist/session.js';
import { LegacyDrawingTemplateCatalog } from '../../dist/bootstrap/LegacyDrawingTemplateCatalog.js';
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
    this.drawings = [];
    this.alerts = [];
    this.groups = new Map();
    this.revision = 0;
  }

  sameIdentity(left, right) {
    return left.chartId === right.chartId
      && left.symbol === right.symbol
      && left.timeframe === right.timeframe
      && left.datasetId === right.datasetId;
  }

  recordIndicator(indicator, identity, resourceId) {
    this.indicators.push({ indicator: structuredClone(indicator), identity: structuredClone(identity), resourceId });
    this.revision += 1;
  }

  recordDrawing(drawing, identity, resourceId) {
    this.drawings.push({ drawing: structuredClone(drawing), identity: structuredClone(identity), resourceId });
    this.revision += 1;
  }

  recordAlert(alert, identity, resourceId) {
    this.alerts.push({ alert: structuredClone(alert), identity: structuredClone(identity), resourceId });
    this.revision += 1;
  }

  removeIndicator(identity, resourceId, indicatorType, params = []) {
    const exact = this.indicators.findIndex((entry) =>
      this.sameIdentity(entry.identity, identity) && entry.resourceId === resourceId,
    );
    const fallback = this.indicators.findIndex((entry) =>
      this.sameIdentity(entry.identity, identity)
      && entry.indicator.type.toLowerCase() === indicatorType.toLowerCase()
      && JSON.stringify(entry.indicator.params ?? []) === JSON.stringify(params),
    );
    const index = exact >= 0 ? exact : fallback;
    if (index >= 0) {
      this.indicators.splice(index, 1);
      this.revision += 1;
    }
  }

  removeAlert(identity, resourceId, price, direction) {
    const exact = this.alerts.findIndex((entry) =>
      this.sameIdentity(entry.identity, identity) && entry.resourceId === resourceId,
    );
    const fallback = this.alerts.findIndex((entry) =>
      this.sameIdentity(entry.identity, identity)
      && entry.alert.price === price
      && (entry.alert.options?.direction ?? 'cross') === direction,
    );
    const index = exact >= 0 ? exact : fallback;
    if (index >= 0) {
      this.alerts.splice(index, 1);
      this.revision += 1;
    }
  }

  replaceDrawingGroup(groupId, drawings, identity, idempotencyKey, resourceIds) {
    this.groups.set(groupId, {
      drawings: structuredClone(drawings),
      identity: structuredClone(identity),
      idempotencyKey,
      resourceIds: structuredClone(resourceIds ?? []),
    });
    this.revision += 1;
  }

  listAgentDrawingGroups(identity) {
    return [...this.groups.entries()]
      .filter(([groupId, group]) =>
        groupId.startsWith('romaco-mcp/')
        && group.identity.chartId === identity.chartId
        && group.identity.symbol === identity.symbol
        && group.identity.timeframe === identity.timeframe
        && group.identity.datasetId === identity.datasetId,
      )
      .map(([groupId, group]) => ({ groupId, drawingCount: group.drawings.length }));
  }

  removeAgentDrawingGroup(groupId, identity) {
    const group = this.groups.get(groupId);
    if (
      group
      && group.identity.chartId === identity.chartId
      && group.identity.symbol === identity.symbol
      && group.identity.timeframe === identity.timeframe
      && group.identity.datasetId === identity.datasetId
    ) {
      this.groups.delete(groupId);
      this.revision += 1;
    }
  }

  structuralRevision() {
    return this.revision;
  }

  snapshot() {
    return {
      indicators: this.indicators.map((entry) => ({
        command: { action: 'addIndicator', indicatorType: entry.indicator.type, params: entry.indicator.params },
        identity: structuredClone(entry.identity),
        resourceIds: entry.resourceId ? [entry.resourceId] : [],
      })),
      drawings: this.drawings.map((entry) => ({
        command: structuredClone(entry.drawing),
        identity: structuredClone(entry.identity),
        resourceIds: entry.resourceId ? [entry.resourceId] : [],
      })),
      drawingGroups: [...this.groups.entries()].map(([groupId, group]) => ({
        command: {
          groupId,
          drawings: structuredClone(group.drawings),
          expectedIdentity: structuredClone(group.identity),
          idempotencyKey: group.idempotencyKey,
        },
        identity: structuredClone(group.identity),
        resourceIds: structuredClone(group.resourceIds),
      })),
      alerts: this.alerts.map((entry) => ({
        command: structuredClone(entry.alert),
        identity: structuredClone(entry.identity),
        resourceIds: entry.resourceId ? [entry.resourceId] : [],
      })),
    };
  }

  bindReplayedResources(command, identity, resourceIds) {
    const resourceId = resourceIds[0];
    if ('idempotencyKey' in command) {
      const group = this.groups.get(command.groupId);
      if (group && this.sameIdentity(group.identity, identity)) group.resourceIds = structuredClone(resourceIds);
      return;
    }
    if (!resourceId) return;
    if (command.action === 'addIndicator') {
      const entry = this.indicators.find((candidate) =>
        this.sameIdentity(candidate.identity, identity)
        && candidate.indicator.type.toLowerCase() === command.indicatorType.toLowerCase()
        && JSON.stringify(candidate.indicator.params ?? []) === JSON.stringify(command.params ?? []),
      );
      if (entry) entry.resourceId = resourceId;
    } else if (command.action === 'addDrawing') {
      const entry = this.drawings.find((candidate) =>
        this.sameIdentity(candidate.identity, identity)
        && candidate.drawing.drawingType === command.drawingType
        && JSON.stringify(candidate.drawing.points) === JSON.stringify(command.points),
      );
      if (entry) entry.resourceId = resourceId;
    } else if (command.action === 'addAlert') {
      const entry = this.alerts.find((candidate) =>
        this.sameIdentity(candidate.identity, identity)
        && candidate.alert.price === command.price
        && (candidate.alert.options?.direction ?? 'cross') === (command.options?.direction ?? 'cross'),
      );
      if (entry) entry.resourceId = resourceId;
    }
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
  const activation = new SerializedActiveSessionActivation(datasets, analyses, projection);
  const loadDataset = new LoadDatasetUseCase(marketData, datasets, activation);
  const resolveThesis = new ResolveThesisArtifactUseCase(
    datasets,
    analyses,
    { read: () => null },
    activation,
    () => 1_788_000_000_000,
  );
  const setupChart = new SetupChartUseCase(loadDataset, chart, presets, journal);
  const annotateThesis = new AnnotateThesisUseCase(resolveThesis, datasets, chart, journal);
  const addDrawing = new AddDrawingUseCase(chart, new LegacyDrawingTemplateCatalog(), journal);
  const clearAgentDrawings = new ClearAgentDrawingsUseCase(chart, journal);
  const openPaperPosition = new OpenPaperPositionUseCase(
    chart,
    new InMemoryPaperPositionIdempotencyStore(),
  );
  const reconcileChart = new ReconcileChartStateUseCase(chart, journal, async () => undefined);
  const analyzeBatch = new AnalyzeBatchUseCase(
    loadDataset,
    resolveThesis,
    activation,
  );
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
      journal,
      analyzeBatch,
      addDrawing,
      clearAgentDrawings,
      openPaperPosition,
      reconcileChart,
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
