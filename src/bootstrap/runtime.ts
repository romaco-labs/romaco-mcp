import { InMemoryAnalysisRepository } from '../adapters/outbound/persistence/InMemoryAnalysisRepository.js';
import { InMemoryDatasetRepository } from '../adapters/outbound/persistence/InMemoryDatasetRepository.js';
import { LoadDatasetUseCase } from '../application/use-cases/loadDataset.js';
import { LegacySessionProjection } from './LegacySessionProjection.js';
import { LegacyMarketDataAdapter } from './LegacyMarketDataAdapter.js';
import { BridgeChartAdapter } from '../adapters/outbound/chart/BridgeChartAdapter.js';
import { bridge } from './bridgeRuntime.js';
import { SetupChartUseCase } from '../application/use-cases/setupChart.js';
import { LegacyPresetCatalog } from './LegacyPresetCatalog.js';
import { LegacyChartJournal } from './LegacyChartJournal.js';
import { ResolveThesisArtifactUseCase } from '../application/use-cases/resolveThesisArtifact.js';
import { LegacySessionDatasetSource } from './LegacySessionDatasetSource.js';
import { AnnotateThesisUseCase } from '../application/use-cases/annotateThesis.js';
import type { ApprovalPort } from '../application/ports/approval.js';
import { InMemoryApprovalStore } from '../adapters/outbound/security/InMemoryApprovalStore.js';
import type { ChartJournalPort } from '../application/ports/chartJournal.js';
import { AddDrawingUseCase } from '../application/use-cases/addDrawing.js';
import { LegacyDrawingTemplateCatalog } from './LegacyDrawingTemplateCatalog.js';
import { AnalyzeBatchUseCase } from '../application/use-cases/analyzeBatch.js';
import { LegacyAgentDrawingJournal } from './LegacyAgentDrawingJournal.js';
import { ClearAgentDrawingsUseCase } from '../application/use-cases/clearAgentDrawings.js';
import { OpenPaperPositionUseCase } from '../application/use-cases/openPaperPosition.js';
import { InMemoryPaperPositionIdempotencyStore } from '../adapters/outbound/persistence/InMemoryPaperPositionIdempotencyStore.js';

export interface ApplicationRuntime {
  datasets: InMemoryDatasetRepository;
  analyses: InMemoryAnalysisRepository;
  loadDataset: LoadDatasetUseCase;
  chart: BridgeChartAdapter;
  setupChart: SetupChartUseCase;
  presetNames: readonly string[];
  resolveThesis: ResolveThesisArtifactUseCase;
  annotateThesis: AnnotateThesisUseCase;
  addDrawing: AddDrawingUseCase;
  approvals: ApprovalPort;
  journal: ChartJournalPort;
  analyzeBatch: AnalyzeBatchUseCase;
  clearAgentDrawings: ClearAgentDrawingsUseCase;
  openPaperPosition: OpenPaperPositionUseCase;
}

export function createProductionRuntime(): ApplicationRuntime {
  const datasets = new InMemoryDatasetRepository();
  const analyses = new InMemoryAnalysisRepository();
  const chart = new BridgeChartAdapter(bridge);
  const presets = new LegacyPresetCatalog();
  const marketData = new LegacyMarketDataAdapter();
  const activeProjection = new LegacySessionProjection();
  const loadDataset = new LoadDatasetUseCase(
    marketData,
    datasets,
    analyses,
    activeProjection,
  );
  const journal = new LegacyChartJournal();
  const drawingTemplates = new LegacyDrawingTemplateCatalog();
  const resolveThesis = new ResolveThesisArtifactUseCase(
    datasets,
    analyses,
    new LegacySessionDatasetSource(),
  );
  const approvals = new InMemoryApprovalStore();
  const agentDrawingJournal = new LegacyAgentDrawingJournal();
  const paperPositionIdempotency = new InMemoryPaperPositionIdempotencyStore();
  return {
    datasets,
    analyses,
    chart,
    loadDataset,
    setupChart: new SetupChartUseCase(loadDataset, chart, presets, journal),
    presetNames: presets.names(),
    resolveThesis,
    approvals,
    journal,
    addDrawing: new AddDrawingUseCase(chart, drawingTemplates, journal),
    analyzeBatch: new AnalyzeBatchUseCase(
      loadDataset,
      resolveThesis,
      datasets,
      analyses,
      activeProjection,
    ),
    clearAgentDrawings: new ClearAgentDrawingsUseCase(chart, agentDrawingJournal),
    openPaperPosition: new OpenPaperPositionUseCase(chart, paperPositionIdempotency),
    annotateThesis: new AnnotateThesisUseCase(
      resolveThesis,
      datasets,
      chart,
      journal,
    ),
  };
}
