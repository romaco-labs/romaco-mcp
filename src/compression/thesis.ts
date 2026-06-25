import type { MarketSummary, PatternHit } from './types.js';

/**
 * Trade thesis synthesizer — the "computed bull/bear debate".
 *
 * Instead of feeding raw numbers to a model and hoping, we DERIVE the debate
 * deterministically from the already-computed MarketSummary: every bull/bear
 * point is a rule over real features, the verdict is a weighted score, and the
 * setup's R/R is arithmetic. Same decision surface, a fraction of the cost,
 * zero hallucination.
 *
 * Pure function — no I/O, no LLM, reasons only over the public MarketSummary.
 * An enhanced server-side version is available in Pro.
 */

export interface ThesisPoint {
  /** Machine-readable factor id, e.g. "bullish_divergence". */
  factor: string;
  /** Contribution to the verdict, 0..~0.3. */
  weight: number;
  /** Short human-readable evidence. */
  detail: string;
}

export interface TradeSetup {
  entry: number;
  stop: number;
  target: number;
  /** Reward-to-risk ratio. Always >= MIN_RR when a setup is present. */
  rr: number;
  basis: string;
}

export interface TradeThesis {
  bias: 'bullish' | 'bearish' | 'neutral';
  verdict: 'long' | 'short' | 'stand_aside';
  confidence: number; // 0..1
  bull: ThesisPoint[];
  bear: ThesisPoint[];
  setup: TradeSetup | null;
  invalidation: { price: number; reason: string } | null;
  horizon: 'intraday' | 'swing' | 'position';
  notes: string[];
}

// ─── Tunable weights ─────────────────────────────────────────────────────────
// Named so the verdict's behavior is auditable in one place. Pinned by scenario
// tests; meant to be iterated against real symbols, not frozen by fixtures alone.
const W = {
  trend: 0.30, // × trend.strength (r²)
  rsiExtreme: 0.2, // oversold / overbought
  macdCross: 0.15, // recent MACD cross
  divergence: 0.25, // recent RSI/MACD divergence — high-signal
  valueLocation: 0.15, // price above/below POC (who controls value)
  levelProximity: 0.12, // holding support / capped at resistance
  pattern: 0.30, // × pattern.confidence
} as const;

const BIAS_THRESHOLD = 0.15; // |net| below this → neutral / stand_aside
const CONF_FULL_MASS = 0.6; // total evidence weight that maps to "full" confidence
const MIN_RR = 1.0; // below this, the setup is not worth taking → stand_aside
const NEAR_LEVEL_PCT = 0.015; // within 1.5% counts as "at" a level
const DEFAULT_ATR_STOP_MULT = 1.5; // stop fallback when no structural level
// A structural (k-means) stop farther than this from entry is "absurdly far" and
// gets clamped to an ATR stop (see buildSetup). Validated on AAPL 2026-06-06:
// the k-means support sat 7.8% / 3.95x ATR below entry — grotesque once drawn.
const STOP_MAX_ATR_MULT = 3; // ...beyond this many ATRs from entry, or
const STOP_MAX_PCT = 0.08; // ...beyond this fraction of price -> clamp to 1.5x ATR
// Evidence is only "current" if it sits in the last fraction of the series.
// Detectors fire patterns/divergences across all history; a setup that completed
// 200 bars ago is not a reason to trade now. Without this, bull/bear evidence from
// stale history cancels out and confidence collapses to ~0 on long real series.
const RECENT_FRACTION = 0.25;
const TARGET_ATR_MULT = 3; // measured-move target size when there is no overhead level
const DEFAULT_TARGET_RR = 2; // measured-move target also guarantees at least this R/R

const BULLISH_PATTERNS: ReadonlySet<PatternHit['kind']> = new Set([
  'inverse_head_shoulders',
  'double_bottom',
  'ascending_triangle',
  'bull_flag',
  'channel_up',
  'falling_wedge',
  'cup_handle',
  'abcd_bullish',
  'gartley_bullish',
  'bat_bullish',
  'butterfly_bullish',
  'crab_bullish',
  'triple_bottom',
  'rounding_bottom',
  'gap_up',
]);
const BEARISH_PATTERNS: ReadonlySet<PatternHit['kind']> = new Set([
  'head_shoulders',
  'double_top',
  'descending_triangle',
  'bear_flag',
  'channel_down',
  'rising_wedge',
  'abcd_bearish',
  'gartley_bearish',
  'bat_bearish',
  'butterfly_bearish',
  'crab_bearish',
  'triple_top',
  'gap_down',
]);
// Direction-neutral structures: no signal until price leaves the range.
const AWAIT_BREAKOUT: ReadonlySet<PatternHit['kind']> = new Set([
  'symmetric_triangle',
  'channel_flat',
]);

const clamp01 = (x: number): number => (x < 0 ? 0 : x > 1 ? 1 : x);
const round = (x: number, dp = 4): number => {
  const f = 10 ** dp;
  return Math.round(x * f) / f;
};

function inferHorizon(tfSeconds: number | undefined): TradeThesis['horizon'] {
  if (!tfSeconds) return 'swing';
  if (tfSeconds < 3600) return 'intraday';
  if (tfSeconds < 86_400) return 'swing';
  return 'position';
}

/** Nearest array value strictly below `price`. */
function nearestBelow(levels: number[], price: number): number | undefined {
  const below = levels.filter((l) => l < price);
  return below.length ? Math.max(...below) : undefined;
}
/** Nearest array value strictly above `price`. */
function nearestAbove(levels: number[], price: number): number | undefined {
  const above = levels.filter((l) => l > price);
  return above.length ? Math.min(...above) : undefined;
}

/**
 * Build the setup for a directional bias. Returns null when no honest setup
 * exists (invalid geometry or R/R below MIN_RR) — we would rather stand aside
 * than manufacture a trade.
 */
function buildSetup(
  dir: 'long' | 'short',
  summary: MarketSummary,
  topPattern: PatternHit | null,
): TradeSetup | null {
  const { last_price } = summary.meta;
  const { support, resistance, poc, vah, val } = summary.levels;
  const atr = summary.volatility.atr;
  const entry = last_price;
  if (!Number.isFinite(entry) || entry <= 0) return null;

  // Candidate structural levels, including value-area edges and POC.
  const supports = [...support, val, poc].filter((v) => Number.isFinite(v) && v > 0);
  const resistances = [...resistance, vah, poc].filter((v) => Number.isFinite(v) && v > 0);

  if (dir === 'long') {
    let stop = nearestBelow(supports, entry);
    if (stop === undefined && atr > 0) stop = entry - DEFAULT_ATR_STOP_MULT * atr;
    if (stop === undefined || !(stop < entry)) return null;
    // Clamp an absurdly-far structural stop to an ATR stop, BEFORE the target so a
    // measured move rescales to the tighter risk (keeps rr >= MIN_RR, compact box).
    let stopClamped = false;
    if (atr > 0 && entry - stop > Math.min(STOP_MAX_ATR_MULT * atr, STOP_MAX_PCT * entry)) {
      stop = entry - DEFAULT_ATR_STOP_MULT * atr;
      stopClamped = true;
    }
    let target = nearestAbove(resistances, entry);
    let basis = 'support→resistance';
    // Prefer a bullish pattern's measured target if it sits above entry.
    if (topPattern && BULLISH_PATTERNS.has(topPattern.kind) && (topPattern.target_price ?? 0) > entry) {
      target = topPattern.target_price!;
      basis = `${topPattern.kind} target`;
    }
    // Price at highs with no overhead level → project a measured move instead of
    // giving up. A nearby resistance that yields rr<MIN_RR is a real obstacle and
    // still fails the guard below; we do not measure through it.
    if (target === undefined) {
      target = entry + Math.max(DEFAULT_TARGET_RR * (entry - stop), TARGET_ATR_MULT * atr);
      basis = 'measured move';
    }
    if (!(target > entry)) return null;
    const rr = (target - entry) / (entry - stop);
    if (!Number.isFinite(rr) || rr < MIN_RR) return null;
    if (stopClamped) basis += ' [ATR stop: structure too far]';
    return { entry: round(entry), stop: round(stop), target: round(target), rr: round(rr, 2), basis };
  }

  // short
  let stop = nearestAbove(resistances, entry);
  if (stop === undefined && atr > 0) stop = entry + DEFAULT_ATR_STOP_MULT * atr;
  if (stop === undefined || !(stop > entry)) return null;
  // Clamp an absurdly-far structural stop to an ATR stop, BEFORE the target.
  let stopClamped = false;
  if (atr > 0 && stop - entry > Math.min(STOP_MAX_ATR_MULT * atr, STOP_MAX_PCT * entry)) {
    stop = entry + DEFAULT_ATR_STOP_MULT * atr;
    stopClamped = true;
  }
  let target = nearestBelow(supports, entry);
  let basis = 'resistance→support';
  if (topPattern && BEARISH_PATTERNS.has(topPattern.kind) && (topPattern.target_price ?? Infinity) < entry) {
    target = topPattern.target_price!;
    basis = `${topPattern.kind} target`;
  }
  if (target === undefined) {
    target = entry - Math.max(DEFAULT_TARGET_RR * (stop - entry), TARGET_ATR_MULT * atr);
    basis = 'measured move';
  }
  if (!(target < entry && target > 0)) return null;
  const rr = (entry - target) / (stop - entry);
  if (!Number.isFinite(rr) || rr < MIN_RR) return null;
  if (stopClamped) basis += ' [ATR stop: structure too far]';
  return { entry: round(entry), stop: round(stop), target: round(target), rr: round(rr, 2), basis };
}

/**
 * Compose a trade thesis from a MarketSummary. Deterministic.
 */
export function composeThesis(summary: MarketSummary): TradeThesis {
  const bull: ThesisPoint[] = [];
  const bear: ThesisPoint[] = [];
  const notes: string[] = [];

  const { last_price, timeframe_seconds } = summary.meta;
  const horizon = inferHorizon(timeframe_seconds);

  // Degenerate input → stand aside, no fabrication.
  if (!summary.meta.candle_count || !Number.isFinite(last_price) || last_price <= 0) {
    return {
      bias: 'neutral',
      verdict: 'stand_aside',
      confidence: 0,
      bull,
      bear,
      setup: null,
      invalidation: null,
      horizon,
      notes: ['insufficient data'],
    };
  }

  // ── Trend ──
  const { direction, strength } = summary.trend;
  if (direction === 'up' && strength > 0) {
    bull.push({ factor: 'uptrend', weight: round(W.trend * strength, 3), detail: `uptrend r²=${round(strength, 2)}` });
  } else if (direction === 'down' && strength > 0) {
    bear.push({ factor: 'downtrend', weight: round(W.trend * strength, 3), detail: `downtrend r²=${round(strength, 2)}` });
  } else {
    notes.push('no clear trend (ranging)');
  }

  // ── Momentum ──
  const m = summary.momentum;
  if (m.rsi_state === 'oversold') {
    bull.push({ factor: 'rsi_oversold', weight: W.rsiExtreme, detail: `RSI ${round(m.rsi, 1)} oversold` });
  } else if (m.rsi_state === 'overbought') {
    bear.push({ factor: 'rsi_overbought', weight: W.rsiExtreme, detail: `RSI ${round(m.rsi, 1)} overbought` });
  }
  if (m.macd_cross === 'bullish') {
    bull.push({ factor: 'macd_bull_cross', weight: W.macdCross, detail: 'recent MACD bullish cross' });
  } else if (m.macd_cross === 'bearish') {
    bear.push({ factor: 'macd_bear_cross', weight: W.macdCross, detail: 'recent MACD bearish cross' });
  }
  // Only the most-recent divergences (the `recent` slice) speak to the current
  // decision — by_kind totals count the whole history and cancel themselves out.
  const recentDiv = m.divergences.recent;
  const bullDiv = recentDiv.filter((d) => d.kind === 'bullish' || d.kind === 'hidden_bullish').length;
  const bearDiv = recentDiv.filter((d) => d.kind === 'bearish' || d.kind === 'hidden_bearish').length;
  if (bullDiv > 0) {
    bull.push({ factor: 'bullish_divergence', weight: W.divergence, detail: `${bullDiv} recent bullish divergence(s)` });
  }
  if (bearDiv > 0) {
    bear.push({ factor: 'bearish_divergence', weight: W.divergence, detail: `${bearDiv} recent bearish divergence(s)` });
  }

  // ── Value location (POC) ──
  const { poc, support, resistance } = summary.levels;
  if (Number.isFinite(poc) && poc > 0) {
    if (last_price >= poc) {
      bull.push({ factor: 'above_poc', weight: W.valueLocation, detail: `price above POC ${round(poc, 2)}` });
    } else {
      bear.push({ factor: 'below_poc', weight: W.valueLocation, detail: `price below POC ${round(poc, 2)}` });
    }
  }

  // ── Level proximity ──
  const nearSup = support.find((s) => Math.abs(last_price - s) / last_price <= NEAR_LEVEL_PCT);
  if (nearSup !== undefined) {
    bull.push({ factor: 'at_support', weight: W.levelProximity, detail: `holding support ${round(nearSup, 2)}` });
  }
  const nearRes = resistance.find((r) => Math.abs(last_price - r) / last_price <= NEAR_LEVEL_PCT);
  if (nearRes !== undefined) {
    bear.push({ factor: 'at_resistance', weight: W.levelProximity, detail: `capped at resistance ${round(nearRes, 2)}` });
  }

  // ── Patterns ──
  // (1) Recency gate: only patterns completing in the last RECENT_FRACTION of the
  // series count. On long real series the detector fires both bullish and bearish
  // patterns across all history; counting stale ones cancels the score to ~0.
  const span = summary.meta.last_ts - summary.meta.first_ts;
  const recencyCut = span > 0 ? summary.meta.last_ts - RECENT_FRACTION * span : -Infinity;
  const recentPatterns = summary.patterns.filter((p) => {
    const latest = p.points.length ? Math.max(...p.points.map((pt) => pt.ts)) : 0;
    return latest >= recencyCut;
  });
  // (2) Dedup by kind — keep the highest-confidence hit per kind so a noisy detector
  // firing the same pattern repeatedly doesn't clutter the debate or skew scores.
  const bestByKind = new Map<PatternHit['kind'], PatternHit>();
  for (const p of recentPatterns) {
    const cur = bestByKind.get(p.kind);
    if (!cur || p.confidence > cur.confidence) bestByKind.set(p.kind, p);
  }
  let topPattern: PatternHit | null = null;
  for (const p of bestByKind.values()) {
    if (AWAIT_BREAKOUT.has(p.kind)) {
      notes.push(`${p.kind.replace(/_/g, ' ')} — await breakout`);
      continue;
    }
    const w = round(W.pattern * p.confidence, 3);
    if (BULLISH_PATTERNS.has(p.kind)) {
      bull.push({ factor: p.kind, weight: w, detail: `${p.kind} (conf ${round(p.confidence, 2)})` });
    } else if (BEARISH_PATTERNS.has(p.kind)) {
      bear.push({ factor: p.kind, weight: w, detail: `${p.kind} (conf ${round(p.confidence, 2)})` });
    }
    if (!topPattern || p.confidence > topPattern.confidence) topPattern = p;
  }

  // ── Context notes (no bias) ──
  if (summary.volatility.bb_squeeze) notes.push('Bollinger squeeze — volatility expansion likely');
  else if (summary.volatility.state === 'expanding') notes.push('volatility expanding');

  // ── Verdict ──
  const bullScore = bull.reduce((s, p) => s + p.weight, 0);
  const bearScore = bear.reduce((s, p) => s + p.weight, 0);
  const total = bullScore + bearScore;
  const net = bullScore - bearScore;

  let bias: TradeThesis['bias'] = 'neutral';
  if (net > BIAS_THRESHOLD) bias = 'bullish';
  else if (net < -BIAS_THRESHOLD) bias = 'bearish';

  // Confidence = agreement (|net|/total) damped by evidence mass (total/CONF_FULL).
  const agreement = total > 0 ? Math.abs(net) / total : 0;
  const mass = clamp01(total / CONF_FULL_MASS);
  let confidence = round(clamp01(agreement * mass), 2);

  // ── Setup + honest R/R guard ──
  let verdict: TradeThesis['verdict'] = bias === 'bullish' ? 'long' : bias === 'bearish' ? 'short' : 'stand_aside';
  let setup: TradeSetup | null = null;
  let invalidation: TradeThesis['invalidation'] = null;

  if (verdict !== 'stand_aside') {
    setup = buildSetup(verdict, summary, topPattern);
    if (!setup) {
      // No clean, positive-expectancy setup → stand aside. Never always-signal.
      notes.push('no clean setup at acceptable R/R — standing aside');
      verdict = 'stand_aside';
      confidence = round(confidence * 0.5, 2);
    } else {
      const patInval =
        topPattern && topPattern.invalidation_price && Number.isFinite(topPattern.invalidation_price)
          ? topPattern.invalidation_price
          : undefined;
      invalidation = {
        price: round(patInval ?? setup.stop),
        reason: patInval ? `${topPattern!.kind} invalidation` : 'structural stop',
      };
    }
  }

  // Cap evidence lists for token budget — strongest factors first.
  const byWeight = (a: ThesisPoint, b: ThesisPoint): number => b.weight - a.weight;

  return {
    bias,
    verdict,
    confidence,
    bull: bull.sort(byWeight).slice(0, 5),
    bear: bear.sort(byWeight).slice(0, 5),
    setup,
    invalidation,
    horizon,
    notes,
  };
}
