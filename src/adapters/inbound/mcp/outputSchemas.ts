import { z } from 'zod';
import { PATTERN_KINDS } from '../../../compression/types.js';

export const TIMEFRAMES = [
  '1m', '2m', '5m', '15m', '30m',
  '1h', '2h', '4h',
  '1d', '5d', '1w', '1mo', '3mo',
] as const;

export const timeframeSchema = z.enum(TIMEFRAMES);

const thesisPointSchema = z.object({
  factor: z.string(),
  weight: z.number(),
  detail: z.string(),
}).strict();

const tradeSetupSchema = z.object({
  entry: z.number(),
  stop: z.number(),
  target: z.number(),
  rr: z.number(),
  basis: z.string(),
}).strict();

export const tradeThesisSchema = z.object({
  bias: z.enum(['bullish', 'bearish', 'neutral']),
  verdict: z.enum(['long', 'short', 'stand_aside']),
  confidence: z.number().min(0).max(1),
  bull: z.array(thesisPointSchema),
  bear: z.array(thesisPointSchema),
  setup: tradeSetupSchema.nullable(),
  invalidation: z.object({ price: z.number(), reason: z.string() }).strict().nullable(),
  horizon: z.enum(['intraday', 'swing', 'position']),
  notes: z.array(z.string()),
}).strict();

export const patternPointSchema = z.object({
  ts: z.number(),
  price: z.number(),
  role: z.string(),
}).strict();

export const patternSchema = z.object({
  kind: z.enum(PATTERN_KINDS),
  confidence: z.number(),
  points: z.array(patternPointSchema),
  target_price: z.number().optional(),
  invalidation_price: z.number().optional(),
}).strict();

export const trimmedPatternSchema = z.object({
  kind: z.enum(PATTERN_KINDS),
  confidence: z.number(),
  target_price: z.number().optional(),
  invalidation_price: z.number().optional(),
  anchor_count: z.number().int().nonnegative(),
}).strict();

export const detectPatternsDataSchema = z.object({
  analysisId: z.string().min(1),
  datasetId: z.string().min(1),
  format: z.enum(['concise', 'full']),
  count: z.number().int().nonnegative(),
  patterns: z.array(z.union([trimmedPatternSchema, patternSchema])),
}).strict();

const levelDetailSchema = z.object({
  price: z.number(),
  touches: z.number(),
  strength: z.number(),
  last_touch_ts: z.number(),
}).strict();

export const marketSummarySchema = z.object({
  meta: z.object({
    candle_count: z.number(),
    timeframe_seconds: z.number().optional(),
    first_ts: z.number(),
    last_ts: z.number(),
    last_price: z.number(),
  }).strict(),
  trend: z.object({
    direction: z.enum(['up', 'down', 'sideways']),
    strength: z.number(),
    duration_candles: z.number(),
    slope_pct_per_candle: z.number(),
  }).strict(),
  plr: z.array(z.object({
    from_ts: z.number(),
    to_ts: z.number(),
    from_price: z.number(),
    to_price: z.number(),
    kind: z.enum(['impulse', 'correction', 'consolidation']),
    magnitude_pct: z.number(),
    candle_count: z.number(),
  }).strict()),
  levels: z.object({
    support: z.array(z.number()),
    resistance: z.array(z.number()),
    poc: z.number(),
    vah: z.number(),
    val: z.number(),
    detail: z.object({
      support: z.array(levelDetailSchema),
      resistance: z.array(levelDetailSchema),
    }).strict().optional(),
  }).strict(),
  momentum: z.object({
    rsi: z.number(),
    rsi_state: z.enum(['overbought', 'oversold', 'neutral']),
    macd_cross: z.enum(['bullish', 'bearish', 'none']),
    macd_histogram: z.number(),
    divergences: z.object({
      count: z.number(),
      by_kind: z.record(z.number()),
      recent: z.array(z.object({
        kind: z.enum(['bullish', 'bearish', 'hidden_bullish', 'hidden_bearish']),
        indicator: z.enum(['rsi', 'macd']),
        ts: z.number(),
        price: z.number(),
      }).strict()),
    }).strict(),
  }).strict(),
  volatility: z.object({
    atr: z.number(),
    atr_pct: z.number(),
    bb_squeeze: z.boolean(),
    bb_width_pct: z.number(),
    state: z.enum(['expanding', 'contracting', 'stable']),
  }).strict(),
  patterns: z.array(patternSchema),
}).strict();

export const datasetDescriptorSchema = z.object({
  datasetId: z.string().min(1),
  symbol: z.string().min(1),
  timeframe: timeframeSchema,
  source: z.enum(['yfinance', 'raw']),
  candleCount: z.number().int().nonnegative(),
  firstTimestamp: z.number().nullable(),
  lastTimestamp: z.number().nullable(),
  lastClose: z.number().nullable(),
  fetchedAt: z.number(),
}).strict();

export const positionSizeDataSchema = z.object({
  calculationId: z.string().min(1),
  side: z.enum(['long', 'short']),
  shares: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  entryPrice: z.number().finite(),
  stopLoss: z.number().finite(),
  stopDistance: z.number().finite(),
  positionValue: z.number().finite(),
  positionPctOfAccount: z.number().finite(),
  maxDollarRisk: z.number().finite(),
  actualDollarRisk: z.number().finite(),
  riskPctOfAccount: z.number().finite(),
  targetPrice: z.number().finite().optional(),
  riskRewardRatio: z.number().finite().optional(),
  grossRiskRewardRatio: z.number().finite().optional(),
  netRiskRewardRatio: z.number().finite().nullable().optional(),
  potentialProfit: z.number().finite().optional(),
  breakevenWinratePct: z.number().finite().optional(),
  netBreakevenWinratePct: z.number().finite().nullable().optional(),
}).strict();

export const loadDatasetDataSchema = z.object({
  dataset: datasetDescriptorSchema,
}).strict();

export const setupChartDataSchema = z.object({
  dataset: datasetDescriptorSchema,
  analysisId: z.string().min(1),
  provider: z.enum(['local', 'gateway']),
  analysis: marketSummarySchema,
  preset: z.object({
    name: z.string(),
    liveStatus: z.enum(['clean', 'disconnected', 'matched', 'identity_mismatch', 'unavailable']),
    chartId: z.string().nullable(),
    indicators: z.array(z.object({
      type: z.string(),
      params: z.array(z.number()).optional(),
      success: z.boolean(),
      resourceId: z.string().optional(),
      error: z.string().optional(),
    }).strict()),
  }).strict(),
  resourceIds: z.array(z.string()),
}).strict();

export const thesisDataSchema = z.object({
  analysisId: z.string().min(1),
  datasetId: z.string().min(1),
  provider: z.enum(['local', 'gateway']),
  thesis: tradeThesisSchema,
  disclaimer: z.string(),
}).strict();

export const compressedChartContextSchema = z.object({
  identity: z.object({
    chartId: z.string().nullable(),
    symbol: z.string().nullable(),
    timeframe: z.string().nullable(),
  }).strict(),
  lastPrice: z.number().nullable(),
  totalCandles: z.number(),
  visibleRange: z.object({
    startIndex: z.number(),
    endIndex: z.number(),
    startTimestamp: z.number().nullable(),
    endTimestamp: z.number().nullable(),
  }).strict(),
  panes: z.array(z.object({
    id: z.string(),
    alias: z.string(),
    indicatorNames: z.array(z.string()),
  }).strict()),
  indicatorCount: z.number(),
  drawingCount: z.number(),
  alertCount: z.number(),
  paperTradingActive: z.boolean(),
  zoomLevel: z.number().nullable(),
  renderBackend: z.string().nullable(),
  locale: z.string().nullable(),
  timezone: z.string().nullable(),
  chartDimensions: z.object({ width: z.number(), height: z.number() }).strict().nullable(),
}).strict();

export const chartContextDataSchema = z.object({
  format: z.literal('concise'),
  chartId: z.string().min(1),
  identity: z.object({
    chartId: z.string().min(1),
    symbol: z.string().optional(),
    timeframe: timeframeSchema.optional(),
    datasetId: z.string().optional(),
  }).strict(),
  context: compressedChartContextSchema,
}).strict();

export const listPanesDataSchema = z.object({
  chartId: z.string().min(1),
  panes: z.array(z.record(z.unknown())),
}).strict();

export const snapshotDataSchema = z.object({
  format: z.enum(['png', 'jpeg']),
  mimeType: z.enum(['image/png', 'image/jpeg']),
  byteLength: z.number().int().nonnegative(),
  sha256: z.string().regex(/^[0-9a-f]{64}$/),
}).strict();

export const addIndicatorDataSchema = z.object({
  indicator: z.object({
    indicatorId: z.string().min(1),
    type: z.string().min(1),
    params: z.array(z.number()),
  }).strict(),
  applied: z.literal(true),
}).strict();

export const indicatorValuesDataSchema = z.object({
  format: z.enum(['concise', 'full']),
  indicatorId: z.string().min(1),
  values: z.record(z.unknown()),
}).strict();

export const annotateDataSchema = z.object({
  analysisId: z.string().min(1),
  datasetId: z.string().min(1),
  chartId: z.string().min(1),
  symbol: z.string().min(1),
  timeframe: timeframeSchema,
  provider: z.enum(['local', 'gateway']),
  verdict: z.enum(['long', 'short', 'stand_aside']),
  groupId: z.string().min(1),
  drawingIds: z.array(z.string()),
  drawingCount: z.number().int().nonnegative(),
  scope: z.enum(['context', 'trade']),
  idempotencyKey: z.string().min(1),
}).strict();

export function describeDataset(dataset: {
  datasetId: string;
  symbol: string;
  timeframe: (typeof TIMEFRAMES)[number];
  source: 'yfinance' | 'raw';
  candles: ReadonlyArray<{ timestamp: number; close: number }>;
  fetchedAt: number;
}) {
  const first = dataset.candles[0];
  const last = dataset.candles[dataset.candles.length - 1];
  return {
    datasetId: dataset.datasetId,
    symbol: dataset.symbol,
    timeframe: dataset.timeframe,
    source: dataset.source,
    candleCount: dataset.candles.length,
    firstTimestamp: first?.timestamp ?? null,
    lastTimestamp: last?.timestamp ?? null,
    lastClose: last?.close ?? null,
    fetchedAt: dataset.fetchedAt,
  };
}
