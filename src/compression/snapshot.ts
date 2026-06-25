// Pure compression helpers used by the gated chart-state tools.
// Every function turns a heavy bridge / analyzer payload into a small
// feature-shaped object that fits under ~2 KB when JSON-stringified.

import type { Candle, PatternHit } from './types.js';

// ──────────────────────────────────────────────────────────────────────────
// Chart context — full bridge payload → small snapshot
// ──────────────────────────────────────────────────────────────────────────

interface ChartContextLike {
  visibleRange?: { startTimestamp?: number; endTimestamp?: number; startIndex?: number; endIndex?: number };
  visibleCandles?: unknown[];
  existingDrawings?: Array<{ id?: string; type?: string; label?: string }>;
  existingIndicators?: Array<{ id?: string; name?: string; params?: unknown[]; visible?: boolean }>;
  panels?: Array<{ id?: string; alias?: string; indicators?: Array<{ name?: string; id?: string }> }>;
  chartDimensions?: { width?: number; height?: number };
  currentPrice?: number;
  totalCandles?: number;
  zoomLevel?: number;
  renderBackend?: string;
  locale?: string;
  timezone?: string;
  alerts?: unknown[];
  paperTrading?: unknown;
  capabilities?: Record<string, boolean>;
}

export interface CompressedChartContext {
  lastPrice: number | null;
  totalCandles: number;
  visibleRange: { startIndex: number; endIndex: number; startTimestamp: number | null; endTimestamp: number | null };
  panes: Array<{ id: string; alias: string; indicatorNames: string[] }>;
  indicatorCount: number;
  drawingCount: number;
  alertCount: number;
  paperTradingActive: boolean;
  zoomLevel: number | null;
  renderBackend: string | null;
  locale: string | null;
  timezone: string | null;
  chartDimensions: { width: number; height: number } | null;
}

export function compressChartContext(ctx: unknown): CompressedChartContext {
  const c = (ctx ?? {}) as ChartContextLike;
  const panes = (c.panels ?? []).map((p) => ({
    id: p.id ?? '',
    alias: p.alias ?? '',
    indicatorNames: (p.indicators ?? []).map((i) => i.name ?? '').filter(Boolean),
  }));
  // Always include the main pane explicitly with its indicator names
  // (panels[] from the bridge sometimes only enumerates subpanels).
  const hasMain = panes.some((p) => p.id === 'main' || p.alias === 'main');
  if (!hasMain) {
    panes.unshift({
      id: 'main',
      alias: 'main',
      indicatorNames: (c.existingIndicators ?? [])
        .filter((i) => i.visible !== false)
        .map((i) => i.name ?? '')
        .filter(Boolean),
    });
  }
  return {
    lastPrice: typeof c.currentPrice === 'number' ? c.currentPrice : null,
    totalCandles: c.totalCandles ?? 0,
    visibleRange: {
      startIndex: c.visibleRange?.startIndex ?? 0,
      endIndex: c.visibleRange?.endIndex ?? 0,
      startTimestamp: c.visibleRange?.startTimestamp ?? null,
      endTimestamp: c.visibleRange?.endTimestamp ?? null,
    },
    panes,
    indicatorCount: (c.existingIndicators ?? []).length,
    drawingCount: (c.existingDrawings ?? []).length,
    alertCount: (c.alerts ?? []).length,
    paperTradingActive: c.paperTrading != null,
    zoomLevel: typeof c.zoomLevel === 'number' ? c.zoomLevel : null,
    renderBackend: c.renderBackend ?? null,
    locale: c.locale ?? null,
    timezone: c.timezone ?? null,
    chartDimensions:
      c.chartDimensions?.width != null && c.chartDimensions?.height != null
        ? { width: c.chartDimensions.width, height: c.chartDimensions.height }
        : null,
  };
}

// ──────────────────────────────────────────────────────────────────────────
// Visible candles — raw OHLCV array → range summary
// ──────────────────────────────────────────────────────────────────────────

interface VisibleCandleLike {
  time?: number;
  timestamp?: number;
  open?: number;
  high?: number;
  low?: number;
  close?: number;
  volume?: number;
}

export interface CompressedVisibleCandles {
  count: number;
  first_ts: number | null;
  last_ts: number | null;
  first_candle: VisibleCandleLike | null;
  last_candle: VisibleCandleLike | null;
  ohlc_range: { minLow: number; maxHigh: number; openFirst: number; closeLast: number } | null;
  volume: { sum: number; avg: number; max: number } | null;
  returns: { pctChange: number; atrApprox: number } | null;
}

export function compressVisibleCandles(candles: VisibleCandleLike[]): CompressedVisibleCandles {
  const arr = Array.isArray(candles) ? candles : [];
  if (arr.length === 0) {
    return {
      count: 0,
      first_ts: null,
      last_ts: null,
      first_candle: null,
      last_candle: null,
      ohlc_range: null,
      volume: null,
      returns: null,
    };
  }
  let minLow = Number.POSITIVE_INFINITY;
  let maxHigh = Number.NEGATIVE_INFINITY;
  let volSum = 0;
  let volMax = 0;
  let trSum = 0; // true-range approximation
  let prevClose: number | null = null;
  for (const c of arr) {
    const low = typeof c.low === 'number' ? c.low : Number.POSITIVE_INFINITY;
    const high = typeof c.high === 'number' ? c.high : Number.NEGATIVE_INFINITY;
    if (low < minLow) minLow = low;
    if (high > maxHigh) maxHigh = high;
    const vol = typeof c.volume === 'number' ? c.volume : 0;
    volSum += vol;
    if (vol > volMax) volMax = vol;
    if (prevClose != null && typeof c.high === 'number' && typeof c.low === 'number') {
      const tr = Math.max(
        c.high - c.low,
        Math.abs(c.high - prevClose),
        Math.abs(c.low - prevClose),
      );
      trSum += tr;
    }
    if (typeof c.close === 'number') prevClose = c.close;
  }
  const first = arr[0];
  const last = arr[arr.length - 1];
  const openFirst = first.open ?? 0;
  const closeLast = last.close ?? 0;
  const firstTs = first.timestamp ?? first.time ?? null;
  const lastTs = last.timestamp ?? last.time ?? null;
  const atrApprox = arr.length > 1 ? trSum / (arr.length - 1) : 0;
  return {
    count: arr.length,
    first_ts: firstTs,
    last_ts: lastTs,
    first_candle: first,
    last_candle: last,
    ohlc_range: { minLow, maxHigh, openFirst, closeLast },
    volume: { sum: volSum, avg: volSum / arr.length, max: volMax },
    returns: {
      pctChange: openFirst > 0 ? ((closeLast - openFirst) / openFirst) * 100 : 0,
      atrApprox,
    },
  };
}

// ──────────────────────────────────────────────────────────────────────────
// Indicator values — full series → last value + state classification
// ──────────────────────────────────────────────────────────────────────────

interface IndicatorSeries {
  // ChartAgentController emits `key`; some bridges emit `name`. Accept both.
  key?: string;
  name?: string;
  values?: number[];
}

interface IndicatorValuesLike {
  id?: string;
  name?: string;
  params?: unknown[];
  series?: IndicatorSeries[];
}

export interface CompressedIndicatorValues {
  id: string | null;
  name: string | null;
  params: unknown[];
  bars: number;
  seriesNames: string[];
  lastValues: Record<string, number | null>;
  prevValues: Record<string, number | null>;
  deltas: Record<string, number | null>;
  state: string;
}

export function compressIndicatorValues(payload: unknown): CompressedIndicatorValues {
  const p = (payload ?? {}) as IndicatorValuesLike;
  const series = Array.isArray(p.series) ? p.series : [];
  const seriesNames = series.map((s) => s.key ?? s.name ?? '').filter(Boolean);
  const lastValues: Record<string, number | null> = {};
  const prevValues: Record<string, number | null> = {};
  const deltas: Record<string, number | null> = {};
  let bars = 0;
  for (const s of series) {
    const vals = Array.isArray(s.values) ? s.values : [];
    bars = Math.max(bars, vals.length);
    // Skip trailing nulls so "last" means the latest computed bar, not the
    // most recent timestamp (indicators warm up — RSI(14) has 14 null bars).
    let lastIdx = vals.length - 1;
    while (lastIdx >= 0 && (typeof vals[lastIdx] !== 'number' || !Number.isFinite(vals[lastIdx] as number))) {
      lastIdx--;
    }
    const lastV = lastIdx >= 0 ? vals[lastIdx] : null;
    const prevV = lastIdx >= 1 ? vals[lastIdx - 1] : null;
    const name = s.key ?? s.name ?? 'value';
    lastValues[name] = typeof lastV === 'number' ? lastV : null;
    prevValues[name] = typeof prevV === 'number' ? prevV : null;
    deltas[name] =
      typeof lastV === 'number' && typeof prevV === 'number' ? lastV - prevV : null;
  }
  return {
    id: p.id ?? null,
    name: p.name ?? null,
    params: Array.isArray(p.params) ? p.params : [],
    bars,
    seriesNames,
    lastValues,
    prevValues,
    deltas,
    state: classifyIndicatorState(p.name ?? '', lastValues, prevValues),
  };
}

function classifyIndicatorState(
  name: string,
  last: Record<string, number | null>,
  prev: Record<string, number | null>,
): string {
  const n = name.toUpperCase();
  if (n === 'RSI') {
    const v = last['value'] ?? last['rsi'] ?? Object.values(last)[0];
    if (typeof v !== 'number') return 'unknown';
    if (v >= 70) return 'overbought';
    if (v <= 30) return 'oversold';
    return 'neutral';
  }
  if (n === 'MACD') {
    const histLast = last['histogram'] ?? last['hist'] ?? null;
    const histPrev = prev['histogram'] ?? prev['hist'] ?? null;
    if (typeof histLast !== 'number' || typeof histPrev !== 'number') return 'unknown';
    if (histPrev < 0 && histLast >= 0) return 'bull_cross';
    if (histPrev > 0 && histLast <= 0) return 'bear_cross';
    return histLast > 0 ? 'bullish' : 'bearish';
  }
  if (n === 'BOLL' || n === 'BOLLINGER') {
    const upper = last['upper'];
    const lower = last['lower'];
    const middle = last['middle'] ?? last['basis'];
    if (typeof upper === 'number' && typeof lower === 'number' && typeof middle === 'number') {
      const width = upper - lower;
      const widthPct = middle > 0 ? (width / middle) * 100 : 0;
      if (widthPct < 1) return 'squeeze';
      if (widthPct > 5) return 'expansion';
    }
    return 'neutral';
  }
  // Default trend-style classification: rising / falling / flat
  const firstVal = Object.values(last)[0];
  const firstPrev = Object.values(prev)[0];
  if (typeof firstVal !== 'number' || typeof firstPrev !== 'number') return 'unknown';
  const delta = firstVal - firstPrev;
  if (Math.abs(delta) < 1e-6) return 'flat';
  return delta > 0 ? 'rising' : 'falling';
}

// ──────────────────────────────────────────────────────────────────────────
// Patterns — full hits (with points[]) → trimmed hits
// ──────────────────────────────────────────────────────────────────────────

export interface TrimmedPatternHit {
  kind: PatternHit['kind'];
  confidence: number;
  target_price?: number;
  invalidation_price?: number;
  anchor_count: number;
}

export function trimPatternHits(hits: PatternHit[]): TrimmedPatternHit[] {
  if (!Array.isArray(hits)) return [];
  return hits.map((h) => ({
    kind: h.kind,
    confidence: h.confidence,
    target_price: h.target_price,
    invalidation_price: h.invalidation_price,
    anchor_count: Array.isArray(h.points) ? h.points.length : 0,
  }));
}

// Re-export Candle so consumers (tests, tools) only need one import path.
export type { Candle };
