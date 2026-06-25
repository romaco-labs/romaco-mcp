// Shared types for semantic compression layer.
// Goal: take raw OHLCV (50-10,000 candles) → compressed MarketSummary (~500 tokens).
// Deterministic, pure functions only. No LLM calls.

export interface Candle {
  timestamp: number;  // unix seconds
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export type Direction = 'up' | 'down' | 'sideways';

export interface TrendSummary {
  direction: Direction;
  strength: number;             // 0..1 — linear regression r^2
  duration_candles: number;     // how many candles in current trend
  slope_pct_per_candle: number; // % change per candle
}

export interface PlrSegment {
  from_ts: number;
  to_ts: number;
  from_price: number;
  to_price: number;
  kind: 'impulse' | 'correction' | 'consolidation';
  magnitude_pct: number;
  candle_count: number;
}

/** Per-level evidence, computed only on request (findLevels withDetail). */
export interface LevelDetail {
  price: number;
  /** Swing pivots that tested this level (within tolerance). */
  touches: number;
  /** 0..1: touch count saturating at 5, scaled by how recent the last test was. */
  strength: number;
  last_touch_ts: number;
}

export interface LevelsSummary {
  support: number[];     // sorted ascending, max 3
  resistance: number[];  // sorted ascending, max 3
  poc: number;           // point of control (highest-volume price level)
  vah: number;           // value area high (70% volume upper bound)
  val: number;           // value area low (70% volume lower bound)
  /** Present only when findLevels ran with { withDetail: true }. */
  detail?: { support: LevelDetail[]; resistance: LevelDetail[] };
}

export interface MomentumSummary {
  rsi: number;                                  // current RSI(14)
  rsi_state: 'overbought' | 'oversold' | 'neutral';
  macd_cross: 'bullish' | 'bearish' | 'none';   // recent (last 3 bars)
  macd_histogram: number;
  divergences: DivergenceSummary;
}

export type DivergenceKind = 'bullish' | 'bearish' | 'hidden_bullish' | 'hidden_bearish';

/**
 * Compressed divergence summary — counts + last 3 most recent.
 * Full divergence point arrays are intentionally dropped to keep payload thin.
 * Use the dedicated `detect_divergences` tool (TODO) to get full point data.
 */
export interface DivergenceSummary {
  count: number;
  by_kind: Record<DivergenceKind, number>;
  recent: Array<{
    kind: DivergenceKind;
    indicator: 'rsi' | 'macd';
    ts: number;     // timestamp of latest price point
    price: number;  // latest price point
  }>;
}

/** @deprecated Internal type — kept only for the legacy `detectDivergences()` helper. */
export interface Divergence {
  kind: DivergenceKind;
  indicator: 'rsi' | 'macd';
  price_points: Array<{ ts: number; price: number }>;
  indicator_points: Array<{ ts: number; value: number }>;
}

export interface VolatilitySummary {
  atr: number;
  atr_pct: number;          // ATR as % of current price
  bb_squeeze: boolean;       // Bollinger Bands width vs Keltner
  bb_width_pct: number;      // band width as % of price
  state: 'expanding' | 'contracting' | 'stable';
}

/** Single source of truth for pattern kinds — PatternHit.kind derives from it,
 *  and tools build their Zod enums from it so they can never drift. */
export const PATTERN_KINDS = [
  'head_shoulders',
  'inverse_head_shoulders',
  'double_top',
  'double_bottom',
  'ascending_triangle',
  'descending_triangle',
  'symmetric_triangle',
  'bull_flag',
  'bear_flag',
  'channel_up',
  'channel_down',
  'channel_flat',
  'rising_wedge',
  'falling_wedge',
  'cup_handle',
  'abcd_bullish',
  'abcd_bearish',
  'gartley_bullish',
  'gartley_bearish',
  'bat_bullish',
  'bat_bearish',
  'butterfly_bullish',
  'butterfly_bearish',
  'crab_bullish',
  'crab_bearish',
  'triple_top',
  'triple_bottom',
  'rounding_bottom',
  'gap_up',
  'gap_down',
] as const;

export type PatternKind = (typeof PATTERN_KINDS)[number];

export interface PatternHit {
  kind: PatternKind;
  confidence: number;       // 0..1
  points: Array<{ ts: number; price: number; role: string }>;
  target_price?: number;    // projected target
  invalidation_price?: number;
}

export interface MarketSummary {
  meta: {
    candle_count: number;
    timeframe_seconds?: number;
    first_ts: number;
    last_ts: number;
    last_price: number;
  };
  trend: TrendSummary;
  plr: PlrSegment[];
  levels: LevelsSummary;
  momentum: MomentumSummary;
  volatility: VolatilitySummary;
  patterns: PatternHit[];
}

export interface Swing {
  ts: number;
  price: number;
  index: number;
  kind: 'high' | 'low';
}
