import type { ToolAnnotations } from '@modelcontextprotocol/sdk/types.js';
import type { ToolRiskMetadata } from './contracts.js';

export const TOOL_CATEGORIES = [
  'chart-read',
  'chart-write',
  'market-data',
  'analysis',
  'risk',
  'discovery',
] as const;

export type ToolCategory = (typeof TOOL_CATEGORIES)[number];

export type ToolContentKind = 'text' | 'image';

export interface ToolOutputContractDescriptor {
  schemaId: string;
  summary: string;
  dataFields: readonly string[];
  identityFields: readonly string[];
  contentKinds: readonly ToolContentKind[];
  supportsNoop?: boolean;
  supportsPartial?: boolean;
}

export interface RomacoToolCatalogEntry {
  name: string;
  title: string;
  category: ToolCategory;
  annotations: Required<Pick<
    ToolAnnotations,
    'readOnlyHint' | 'destructiveHint' | 'idempotentHint' | 'openWorldHint'
  >>;
  risk: ToolRiskMetadata;
  output: ToolOutputContractDescriptor;
}

const TEXT = ['text'] as const;
const TEXT_IMAGE = ['text', 'image'] as const;

/**
 * Metadata source of truth for all public v0.x tools. Existing handlers migrate
 * to these descriptors incrementally; catalog presence does not claim migration.
 */
export const ROMACO_TOOL_CATALOG = [
  {
    name: 'romaco_get_chart_context',
    title: 'Get Chart Context',
    category: 'chart-read',
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    risk: { level: 'low', financial: false, approval: 'none' },
    output: {
      schemaId: 'romaco.get-chart-context.v1',
      summary: 'Compressed or explicitly requested raw chart context.',
      dataFields: ['format', 'chartId', 'identity', 'context'],
      identityFields: ['chartId'],
      contentKinds: TEXT,
    },
  },
  {
    name: 'romaco_get_visible_candles',
    title: 'Get Visible Candles',
    category: 'chart-read',
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    risk: { level: 'low', financial: false, approval: 'none' },
    output: {
      schemaId: 'romaco.get-visible-candles.v1',
      summary: 'Visible candle summary or explicitly requested raw candles.',
      dataFields: ['format', 'candles'],
      identityFields: ['chartId', 'symbol', 'timeframe'],
      contentKinds: TEXT,
    },
  },
  {
    name: 'romaco_add_indicator',
    title: 'Add Indicator',
    category: 'chart-write',
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    risk: { level: 'medium', financial: false, approval: 'explicit-user-intent' },
    output: {
      schemaId: 'romaco.add-indicator.v1',
      summary: 'Applied indicator and host-assigned identity.',
      dataFields: ['indicator', 'applied'],
      identityFields: ['chartId', 'datasetId'],
      contentKinds: TEXT,
    },
  },
  {
    name: 'romaco_add_drawing',
    title: 'Add Drawing',
    category: 'chart-write',
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    risk: { level: 'medium', financial: false, approval: 'explicit-user-intent' },
    output: {
      schemaId: 'romaco.add-drawing.v1',
      summary: 'Applied drawing and host-assigned identity.',
      dataFields: ['drawingId', 'drawing', 'applied', 'identity'],
      identityFields: ['chartId', 'datasetId'],
      contentKinds: TEXT,
    },
  },
  {
    name: 'romaco_set_zoom',
    title: 'Set Chart Zoom',
    category: 'chart-write',
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    risk: { level: 'low', financial: false, approval: 'none' },
    output: {
      schemaId: 'romaco.set-zoom.v1',
      summary: 'Relative zoom operation and resulting zoom when available.',
      dataFields: ['direction', 'factor', 'zoomLevel'],
      identityFields: ['chartId'],
      contentKinds: TEXT,
    },
  },
  {
    name: 'romaco_reset_view',
    title: 'Reset Chart View',
    category: 'chart-write',
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    risk: { level: 'low', financial: false, approval: 'none' },
    output: {
      schemaId: 'romaco.reset-view.v1',
      summary: 'Absolute chart viewport reset.',
      dataFields: ['reset', 'zoomLevel'],
      identityFields: ['chartId'],
      contentKinds: TEXT,
      supportsNoop: true,
    },
  },
  {
    name: 'romaco_add_alert',
    title: 'Add Price Alert',
    category: 'chart-write',
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    risk: { level: 'medium', financial: true, approval: 'explicit-user-intent' },
    output: {
      schemaId: 'romaco.add-alert.v1',
      summary: 'Applied price alert and host-assigned identity.',
      dataFields: ['alert', 'applied'],
      identityFields: ['chartId', 'datasetId'],
      contentKinds: TEXT,
    },
  },
  {
    name: 'romaco_remove_alert',
    title: 'Remove Price Alert',
    category: 'chart-write',
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false },
    risk: { level: 'medium', financial: true, approval: 'explicit-user-intent' },
    output: {
      schemaId: 'romaco.remove-alert.v1',
      summary: 'Alert removal by stable identity.',
      dataFields: ['alertId', 'removed'],
      identityFields: ['chartId'],
      contentKinds: TEXT,
      supportsNoop: true,
    },
  },
  {
    name: 'romaco_clear_alerts',
    title: 'Clear Price Alerts',
    category: 'chart-write',
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false },
    risk: { level: 'medium', financial: true, approval: 'confirmation-token' },
    output: {
      schemaId: 'romaco.clear-alerts.v1',
      summary: 'Approved exact-alert removal result for one chart identity.',
      dataFields: ['planId', 'alertIds', 'removedCount', 'scope'],
      identityFields: ['chartId', 'symbol', 'timeframe'],
      contentKinds: TEXT,
      supportsNoop: true,
    },
  },
  {
    name: 'romaco_remove_indicator',
    title: 'Remove Indicator',
    category: 'chart-write',
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false },
    risk: { level: 'medium', financial: false, approval: 'explicit-user-intent' },
    output: {
      schemaId: 'romaco.remove-indicator.v1',
      summary: 'Indicator removal by stable identity.',
      dataFields: ['indicatorId', 'type', 'removed'],
      identityFields: ['chartId'],
      contentKinds: TEXT,
      supportsNoop: true,
    },
  },
  {
    name: 'romaco_capture_snapshot',
    title: 'Capture Chart Snapshot',
    category: 'chart-read',
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    risk: { level: 'medium', financial: false, approval: 'explicit-user-intent' },
    output: {
      schemaId: 'romaco.capture-snapshot.v1',
      summary: 'Image content plus compact mime, size, and digest metadata.',
      dataFields: ['format', 'mimeType', 'byteLength', 'sha256'],
      identityFields: ['chartId'],
      contentKinds: TEXT_IMAGE,
    },
  },
  {
    name: 'romaco_open_paper_position',
    title: 'Open Paper Position',
    category: 'chart-write',
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    risk: { level: 'high', financial: true, approval: 'confirmation-token' },
    output: {
      schemaId: 'romaco.open-paper-position.v1',
      summary: 'Approval-gated simulated position with deterministic idempotent receipt.',
      dataFields: ['position', 'idempotencyKey', 'replayed'],
      identityFields: ['chartId', 'symbol', 'timeframe'],
      contentKinds: TEXT,
    },
  },
  {
    name: 'romaco_clear_drawings',
    title: 'Clear Drawings',
    category: 'chart-write',
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false },
    risk: { level: 'high', financial: false, approval: 'confirmation-token' },
    output: {
      schemaId: 'romaco.clear-drawings.v1',
      summary: 'Approved removal count limited to Romaco-managed drawing groups.',
      dataFields: ['planId', 'groupIds', 'removedCount', 'scope'],
      identityFields: ['chartId', 'symbol', 'timeframe'],
      contentKinds: TEXT,
      supportsNoop: true,
    },
  },
  {
    name: 'romaco_list_panes',
    title: 'List Chart Panes',
    category: 'chart-read',
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    risk: { level: 'low', financial: false, approval: 'none' },
    output: {
      schemaId: 'romaco.list-panes.v1',
      summary: 'Current chart pane identities and hosted indicators.',
      dataFields: ['chartId', 'panes'],
      identityFields: ['chartId'],
      contentKinds: TEXT,
    },
  },
  {
    name: 'romaco_get_indicator_values',
    title: 'Get Indicator Values',
    category: 'chart-read',
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    risk: { level: 'low', financial: true, approval: 'none' },
    output: {
      schemaId: 'romaco.get-indicator-values.v1',
      summary: 'Compressed or explicitly requested raw indicator values.',
      dataFields: ['format', 'indicator', 'values'],
      identityFields: ['chartId', 'datasetId'],
      contentKinds: TEXT,
    },
  },
  {
    name: 'romaco_go_to_timestamp',
    title: 'Go to Timestamp',
    category: 'chart-write',
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    risk: { level: 'low', financial: false, approval: 'none' },
    output: {
      schemaId: 'romaco.go-to-timestamp.v1',
      summary: 'Requested and actual viewport or replay timestamp.',
      dataFields: ['targetTimestamp', 'actualTimestamp', 'mode'],
      identityFields: ['chartId'],
      contentKinds: TEXT,
      supportsNoop: true,
    },
  },
  {
    name: 'romaco_list_templates',
    title: 'List Drawing Templates',
    category: 'discovery',
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    risk: { level: 'low', financial: false, approval: 'none' },
    output: {
      schemaId: 'romaco.list-templates.v1',
      summary: 'Versioned drawing-template catalog.',
      dataFields: ['count', 'catalogVersion', 'templates'],
      identityFields: [],
      contentKinds: TEXT,
    },
  },
  {
    name: 'romaco_setup_chart',
    title: 'Setup Chart',
    category: 'market-data',
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true },
    risk: { level: 'medium', financial: true, approval: 'explicit-user-intent' },
    output: {
      schemaId: 'romaco.setup-chart.v1',
      summary: 'Loaded dataset, applied preset result, and deterministic analysis.',
      dataFields: ['dataset', 'analysisId', 'provider', 'analysis', 'preset', 'resourceIds'],
      identityFields: ['chartId', 'datasetId', 'analysisId', 'symbol', 'timeframe'],
      contentKinds: TEXT,
      supportsPartial: true,
    },
  },
  {
    name: 'romaco_load_candles',
    title: 'Load Candles',
    category: 'market-data',
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true },
    risk: { level: 'medium', financial: true, approval: 'none' },
    output: {
      schemaId: 'romaco.load-candles.v1',
      summary: 'Persisted dataset identity and compact range metadata.',
      dataFields: ['dataset'],
      identityFields: ['datasetId', 'symbol', 'timeframe'],
      contentKinds: TEXT,
    },
  },
  {
    name: 'romaco_analyze_market',
    title: 'Analyze Market',
    category: 'analysis',
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    risk: { level: 'medium', financial: true, approval: 'none' },
    output: {
      schemaId: 'romaco.analyze-market.v1',
      summary: 'Versioned deterministic market analysis with provenance.',
      dataFields: ['analysisId', 'datasetId', 'engine', 'degradedFrom', 'summary'],
      identityFields: ['datasetId', 'analysisId', 'symbol', 'timeframe'],
      contentKinds: TEXT,
      supportsPartial: true,
    },
  },
  {
    name: 'romaco_thesis',
    title: 'Build Trade Thesis',
    category: 'analysis',
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    risk: { level: 'high', financial: true, approval: 'none' },
    output: {
      schemaId: 'romaco.thesis.v1',
      summary: 'Grounded thesis, provenance, setup, and educational disclaimer.',
      dataFields: ['analysisId', 'datasetId', 'engine', 'thesis', 'disclaimer'],
      identityFields: ['datasetId', 'analysisId', 'symbol', 'timeframe'],
      contentKinds: TEXT,
      supportsPartial: true,
    },
  },
  {
    name: 'romaco_thesis_batch',
    title: 'Rank Trade Theses',
    category: 'analysis',
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true },
    risk: { level: 'high', financial: true, approval: 'none' },
    output: {
      schemaId: 'romaco.thesis-batch.v1',
      summary: 'Ranked thesis items, top selection, and per-symbol failures.',
      dataFields: ['items', 'top', 'failures', 'sessionDatasetId', 'disclaimer'],
      identityFields: ['datasetId', 'analysisId', 'symbol', 'timeframe'],
      contentKinds: TEXT,
      supportsPartial: true,
    },
  },
  {
    name: 'romaco_annotate',
    title: 'Annotate Trade Thesis',
    category: 'chart-write',
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false },
    risk: { level: 'high', financial: true, approval: 'confirmation-token' },
    output: {
      schemaId: 'romaco.annotate.v1',
      summary: 'Atomic thesis drawing-group replacement result.',
      dataFields: [
        'analysisId', 'datasetId', 'chartId', 'symbol', 'timeframe', 'provider',
        'verdict', 'groupId', 'drawingIds', 'drawingCount', 'scope', 'idempotencyKey',
      ],
      identityFields: ['chartId', 'datasetId', 'analysisId', 'symbol', 'timeframe'],
      contentKinds: TEXT,
      supportsNoop: true,
      supportsPartial: true,
    },
  },
  {
    name: 'romaco_draw_pattern',
    title: 'Draw Detected Pattern',
    category: 'chart-write',
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false },
    risk: { level: 'medium', financial: true, approval: 'explicit-user-intent' },
    output: {
      schemaId: 'romaco.draw-pattern.v1',
      summary: 'Atomic detected-pattern drawing-group replacement result.',
      dataFields: ['pattern', 'groupId', 'drawingIds', 'replaced', 'failures'],
      identityFields: ['chartId', 'datasetId', 'analysisId', 'symbol', 'timeframe'],
      contentKinds: TEXT,
      supportsNoop: true,
      supportsPartial: true,
    },
  },
  {
    name: 'romaco_find_levels',
    title: 'Find Support and Resistance',
    category: 'analysis',
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    risk: { level: 'medium', financial: true, approval: 'none' },
    output: {
      schemaId: 'romaco.find-levels.v1',
      summary: 'Deterministic support, resistance, and volume-profile levels.',
      dataFields: ['analysisId', 'datasetId', 'levels'],
      identityFields: ['datasetId', 'analysisId', 'symbol', 'timeframe'],
      contentKinds: TEXT,
    },
  },
  {
    name: 'romaco_detect_patterns',
    title: 'Detect Chart Patterns',
    category: 'analysis',
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    risk: { level: 'medium', financial: true, approval: 'none' },
    output: {
      schemaId: 'romaco.detect-patterns.v1',
      summary: 'Compressed or explicitly requested detailed pattern detections.',
      dataFields: ['analysisId', 'datasetId', 'format', 'count', 'patterns'],
      identityFields: ['datasetId', 'analysisId', 'symbol', 'timeframe'],
      contentKinds: TEXT,
    },
  },
  {
    name: 'romaco_calculate_position_size',
    title: 'Calculate Position Size',
    category: 'risk',
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    risk: { level: 'high', financial: true, approval: 'none' },
    output: {
      schemaId: 'romaco.calculate-position-size.v1',
      summary: 'Commission-aware deterministic position sizing result.',
      dataFields: [
        'calculationId', 'side', 'shares', 'entryPrice', 'stopLoss', 'stopDistance',
        'positionValue', 'positionPctOfAccount', 'maxDollarRisk', 'actualDollarRisk',
        'riskPctOfAccount', 'targetPrice', 'grossRiskRewardRatio', 'netRiskRewardRatio',
      ],
      identityFields: [],
      contentKinds: TEXT,
    },
  },
] as const satisfies readonly RomacoToolCatalogEntry[];

export type RomacoToolName = (typeof ROMACO_TOOL_CATALOG)[number]['name'];

export const ROMACO_TOOL_CATALOG_BY_NAME = new Map<RomacoToolName, RomacoToolCatalogEntry>(
  ROMACO_TOOL_CATALOG.map((entry) => [entry.name, entry]),
);
