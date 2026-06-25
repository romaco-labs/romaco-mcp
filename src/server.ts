import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { registerGetChartContext } from './tools/get_chart_context.js';
import { registerGetVisibleCandles } from './tools/get_visible_candles.js';
import { registerAddIndicator } from './tools/add_indicator.js';
import { registerAddDrawing } from './tools/add_drawing.js';
import { registerSetZoom } from './tools/set_zoom.js';
import { registerAddAlert } from './tools/add_alert.js';
import { registerRemoveAlert } from './tools/remove_alert.js';
import { registerClearAlerts } from './tools/clear_alerts.js';
import { registerRemoveIndicator } from './tools/remove_indicator.js';
import { registerCaptureSnapshot } from './tools/capture_snapshot.js';
import { registerOpenPaperPosition } from './tools/open_paper_position.js';
import { registerClearDrawings } from './tools/clear_drawings.js';
import { registerLoadCandles } from './tools/load_candles.js';
import { registerAnalyzeMarket } from './tools/analyze_market.js';
import { registerThesis } from './tools/thesis.js';
import { registerThesisBatch } from './tools/thesis_batch.js';
import { registerAnnotate } from './tools/annotate.js';
import { registerDrawPattern } from './tools/draw_pattern.js';
import { registerFindLevels } from './tools/find_levels.js';
import { registerDetectPatterns } from './tools/detect_patterns.js';
import { registerSetupChart } from './tools/setup_chart.js';
import { registerCalculatePositionSize } from './tools/calculate_position_size.js';
import { registerListTemplates } from './tools/list_templates.js';
import { registerListPanes } from './tools/list_panes.js';
import { registerGetIndicatorValues } from './tools/get_indicator_values.js';
import { registerGoToTimestamp } from './tools/go_to_timestamp.js';

export function createServer(): McpServer {
  const server = new McpServer({
    name: 'romaco',
    version: '0.0.1',
  });

  // Browser-bridge tools (require <McpBridge /> in user's app)
  registerGetChartContext(server);
  registerGetVisibleCandles(server);
  registerAddIndicator(server);
  registerAddDrawing(server);
  registerSetZoom(server);       // also registers romaco_reset_view
  registerAddAlert(server);
  registerRemoveAlert(server);
  registerClearAlerts(server);
  registerRemoveIndicator(server);
  registerCaptureSnapshot(server);
  registerOpenPaperPosition(server);
  registerClearDrawings(server);

  // Living Annotations — Phase 0 unlock
  registerListPanes(server);
  registerGetIndicatorValues(server);
  registerGoToTimestamp(server);

  // Headless data + analysis tools (no browser required)
  registerListTemplates(server);
  registerSetupChart(server);          // one-command setup: load + preset + analyze
  registerLoadCandles(server);
  registerAnalyzeMarket(server);
  registerThesis(server);
  registerThesisBatch(server);         // multi-symbol ranked analysis
  registerAnnotate(server);            // draws the thesis on the chart (needs <McpBridge />)
  registerDrawPattern(server);         // draws detected pattern geometry (needs <McpBridge />)
  registerFindLevels(server);
  registerDetectPatterns(server);
  registerCalculatePositionSize(server);

  return server;
}
