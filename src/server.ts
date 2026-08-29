import { createRequire } from 'node:module';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { registerGetChartContext } from './tools/get_chart_context.js';
import { registerGetVisibleCandles } from './tools/get_visible_candles.js';
import { registerAddIndicator } from './tools/add_indicator.js';
import { registerAddDrawing } from './adapters/inbound/mcp/tools/addDrawing.js';
import { registerSetZoom } from './tools/set_zoom.js';
import { registerAddAlert } from './tools/add_alert.js';
import { registerRemoveAlert } from './tools/remove_alert.js';
import { registerClearAlerts } from './adapters/inbound/mcp/tools/clearAlerts.js';
import { registerRemoveIndicator } from './tools/remove_indicator.js';
import { registerCaptureSnapshot } from './tools/capture_snapshot.js';
import { registerOpenPaperPosition } from './adapters/inbound/mcp/tools/openPaperPosition.js';
import { registerClearDrawings } from './adapters/inbound/mcp/tools/clearDrawings.js';
import { registerLoadCandles } from './tools/load_candles.js';
import { registerAnalyzeMarket } from './tools/analyze_market.js';
import { registerThesis } from './tools/thesis.js';
import { registerThesisBatch } from './tools/thesis_batch.js';
import { registerAnnotate } from './adapters/inbound/mcp/tools/annotateThesis.js';
import { registerDrawPattern } from './tools/draw_pattern.js';
import { registerFindLevels } from './tools/find_levels.js';
import { registerDetectPatterns } from './tools/detect_patterns.js';
import { registerSetupChart } from './tools/setup_chart.js';
import { registerCalculatePositionSize } from './tools/calculate_position_size.js';
import { registerListTemplates } from './tools/list_templates.js';
import { registerListPanes } from './tools/list_panes.js';
import { registerGetIndicatorValues } from './tools/get_indicator_values.js';
import { registerGoToTimestamp } from './tools/go_to_timestamp.js';
import { createProductionRuntime, type ApplicationRuntime } from './bootstrap/runtime.js';
import { decorateServerWithToolCatalog } from './adapters/inbound/mcp/catalogDecorator.js';
import type { ToolTelemetrySink } from './adapters/inbound/mcp/telemetry.js';
import { createConfiguredToolTelemetrySink } from './bootstrap/telemetry.js';

// Versión SIEMPRE desde package.json — la 0.0.2 hardcodeada quedó
// desincronizada del paquete publicado (0.0.3) y serverInfo mentía.
const { version: PKG_VERSION } = createRequire(import.meta.url)('../package.json') as {
  version: string;
};

export interface CreateServerOptions {
  /** null explicitly disables telemetry even when environment opt-in is set. */
  telemetry?: ToolTelemetrySink | null;
  /** Emits a local fallback warning only; never enables remote behavior. */
  warnRemoteEgressDisabled?: boolean;
}

export function createServer(
  runtime: ApplicationRuntime = createProductionRuntime(),
  options: CreateServerOptions = {},
): McpServer {
  const telemetry = options.telemetry === null
    ? undefined
    : options.telemetry ?? createConfiguredToolTelemetrySink();
  const contractOptions = { telemetry };
  const warnRemoteEgressDisabled = options.warnRemoteEgressDisabled
    ?? Boolean(process.env.ROMACO_TOKEN?.trim());
  const server = decorateServerWithToolCatalog(new McpServer({
    name: 'romaco',
    version: PKG_VERSION,
  }));

  // Browser-bridge tools (require <McpBridge /> in user's app)
  registerGetChartContext(server, runtime.chart, contractOptions);
  registerGetVisibleCandles(server);
  registerAddIndicator(server, runtime.chart, runtime.journal, contractOptions);
  registerAddDrawing(server, runtime.addDrawing, contractOptions);
  registerSetZoom(server);       // also registers romaco_reset_view
  registerAddAlert(server, runtime.chart, runtime.journal);
  registerRemoveAlert(server, runtime.chart, runtime.journal);
  registerClearAlerts(server, runtime.clearAlerts, runtime.approvals, contractOptions);
  registerRemoveIndicator(server, runtime.chart, runtime.journal);
  registerCaptureSnapshot(server, runtime.chart, contractOptions);
  registerOpenPaperPosition(
    server,
    runtime.openPaperPosition,
    runtime.approvals,
    contractOptions,
  );
  registerClearDrawings(
    server,
    runtime.clearAgentDrawings,
    runtime.approvals,
    contractOptions,
  );

  // Living Annotations — Phase 0 unlock
  registerListPanes(server, runtime.chart, contractOptions);
  registerGetIndicatorValues(server, runtime.chart, contractOptions);
  registerGoToTimestamp(server);

  // Headless data + analysis tools (no browser required)
  registerListTemplates(server);
  registerSetupChart(
    server,
    runtime.setupChart,
    runtime.resolveThesis,
    runtime.presetNames,
    contractOptions,
  );
  registerLoadCandles(server, runtime.loadDataset, contractOptions);
  registerAnalyzeMarket(server);
  registerThesis(server, runtime.resolveThesis, {
    ...contractOptions,
    warnRemoteEgressDisabled,
  });
  registerThesisBatch(server, runtime.analyzeBatch, contractOptions); // multi-symbol ranked analysis
  registerAnnotate(
    server,
    runtime.annotateThesis,
    runtime.resolveThesis,
    runtime.approvals,
    contractOptions,
  );
  registerDrawPattern(server, runtime.chart);
  registerFindLevels(server);
  registerDetectPatterns(server, runtime.resolveThesis, contractOptions);
  registerCalculatePositionSize(server, undefined, contractOptions);

  return server;
}
