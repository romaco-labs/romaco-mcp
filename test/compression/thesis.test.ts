import { describe, expect, it } from 'vitest';
import { composeThesis } from '../../src/compression/thesis.js';
import type { MarketSummary, MomentumSummary, LevelsSummary, PatternHit } from '../../src/compression/types.js';

/** Neutral baseline MarketSummary; override slices per scenario. */
function mkSummary(o: {
  last_price?: number;
  timeframe_seconds?: number;
  candle_count?: number;
  trend?: Partial<MarketSummary['trend']>;
  momentum?: Partial<MomentumSummary>;
  levels?: Partial<LevelsSummary>;
  patterns?: PatternHit[];
  volatility?: Partial<MarketSummary['volatility']>;
} = {}): MarketSummary {
  return {
    meta: {
      candle_count: o.candle_count ?? 200,
      timeframe_seconds: o.timeframe_seconds ?? 86_400,
      first_ts: 1_700_000_000,
      last_ts: 1_700_000_000 + 200 * 86_400,
      last_price: o.last_price ?? 100,
    },
    trend: { direction: 'sideways', strength: 0, duration_candles: 0, slope_pct_per_candle: 0, ...o.trend },
    plr: [],
    levels: { support: [], resistance: [], poc: 0, vah: 0, val: 0, ...o.levels },
    momentum: {
      rsi: 50,
      rsi_state: 'neutral',
      macd_cross: 'none',
      macd_histogram: 0,
      divergences: { count: 0, by_kind: { bullish: 0, bearish: 0, hidden_bullish: 0, hidden_bearish: 0 }, recent: [] },
      ...o.momentum,
    },
    volatility: { atr: 1, atr_pct: 1, bb_squeeze: false, bb_width_pct: 2, state: 'stable', ...o.volatility },
    patterns: o.patterns ?? [],
  };
}

// A point at mkSummary's last_ts (1_700_000_000 + 200*86_400) so patterns clear
// the recency gate (only patterns completing in the last 25% of the series count).
const PT = [{ ts: 1_717_280_000, price: 100, role: 'apex' }];

const div = (kind: 'bullish' | 'bearish'): MomentumSummary['divergences'] => ({
  count: 1,
  by_kind: { bullish: kind === 'bullish' ? 1 : 0, bearish: kind === 'bearish' ? 1 : 0, hidden_bullish: 0, hidden_bearish: 0 },
  recent: [{ kind, indicator: 'rsi', ts: 1, price: 100 }],
});

describe('composeThesis — directional verdicts', () => {
  it('stacked bullish evidence → verdict long with a positive-R/R setup', () => {
    const t = composeThesis(
      mkSummary({
        last_price: 100,
        trend: { direction: 'up', strength: 0.8 },
        momentum: { rsi: 28, rsi_state: 'oversold', macd_cross: 'bullish', divergences: div('bullish') },
        levels: { support: [95], resistance: [110], poc: 98, vah: 105, val: 96 },
      }),
    );
    expect(t.bias).toBe('bullish');
    expect(t.verdict).toBe('long');
    expect(t.bull.length).toBeGreaterThan(0);
    expect(t.setup).not.toBeNull();
    expect(t.setup!.rr).toBeGreaterThanOrEqual(1);
    expect(t.setup!.stop).toBeLessThan(t.setup!.entry);
    expect(t.setup!.target).toBeGreaterThan(t.setup!.entry);
    expect(t.invalidation).not.toBeNull();
    expect(t.confidence).toBeGreaterThan(0);
  });

  it('stacked bearish evidence → verdict short with a positive-R/R setup', () => {
    const t = composeThesis(
      mkSummary({
        last_price: 100,
        trend: { direction: 'down', strength: 0.8 },
        momentum: { rsi: 74, rsi_state: 'overbought', macd_cross: 'bearish', divergences: div('bearish') },
        levels: { support: [88], resistance: [105], poc: 102, vah: 106, val: 92 },
      }),
    );
    expect(t.bias).toBe('bearish');
    expect(t.verdict).toBe('short');
    expect(t.bear.length).toBeGreaterThan(0);
    expect(t.setup).not.toBeNull();
    expect(t.setup!.rr).toBeGreaterThanOrEqual(1);
    expect(t.setup!.stop).toBeGreaterThan(t.setup!.entry);
    expect(t.setup!.target).toBeLessThan(t.setup!.entry);
  });

  it('conflicting evidence → neutral / stand_aside, no setup', () => {
    const t = composeThesis(
      mkSummary({
        last_price: 100,
        trend: { direction: 'up', strength: 0.5 }, // bull ~0.15
        momentum: { rsi: 72, rsi_state: 'overbought' }, // bear 0.2
      }),
    );
    expect(t.bias).toBe('neutral');
    expect(t.verdict).toBe('stand_aside');
    expect(t.setup).toBeNull();
    expect(t.invalidation).toBeNull();
  });
});

describe('composeThesis — honest R/R guard', () => {
  it('bullish bias but only a sub-1 R/R setup → stands aside, no fabricated trade', () => {
    const t = composeThesis(
      mkSummary({
        last_price: 100,
        trend: { direction: 'up', strength: 0.9 },
        momentum: { rsi: 25, rsi_state: 'oversold', macd_cross: 'bullish', divergences: div('bullish') },
        // tight levels → target barely above, stop far → rr << 1
        levels: { support: [99], resistance: [100.3], poc: 100, vah: 100.1, val: 99.2 },
      }),
    );
    expect(t.bias).toBe('bullish'); // evidence is still bullish…
    expect(t.verdict).toBe('stand_aside'); // …but no clean setup → stand aside
    expect(t.setup).toBeNull();
    expect(t.notes.some((n) => /no clean setup/i.test(n))).toBe(true);
  });

  it('prefers a bullish pattern measured target when above entry', () => {
    const pattern: PatternHit = {
      kind: 'inverse_head_shoulders',
      confidence: 0.8,
      points: PT,
      target_price: 130,
      invalidation_price: 94,
    };
    const t = composeThesis(
      mkSummary({
        last_price: 100,
        trend: { direction: 'up', strength: 0.7 },
        momentum: { rsi: 30, rsi_state: 'oversold' },
        levels: { support: [95], resistance: [110], poc: 98, vah: 105, val: 96 },
        patterns: [pattern],
      }),
    );
    expect(t.verdict).toBe('long');
    expect(t.setup!.target).toBe(130);
    expect(t.setup!.basis).toContain('inverse_head_shoulders');
    expect(t.invalidation!.price).toBe(94);
  });
});

describe('composeThesis — edges & shape', () => {
  it('degenerate summary (no candles) → stand_aside, confidence 0', () => {
    const t = composeThesis(mkSummary({ candle_count: 0, last_price: 0 }));
    expect(t.verdict).toBe('stand_aside');
    expect(t.confidence).toBe(0);
    expect(t.setup).toBeNull();
  });

  it('infers horizon from timeframe', () => {
    expect(composeThesis(mkSummary({ timeframe_seconds: 300 })).horizon).toBe('intraday');
    expect(composeThesis(mkSummary({ timeframe_seconds: 3600 })).horizon).toBe('swing');
    expect(composeThesis(mkSummary({ timeframe_seconds: 86_400 })).horizon).toBe('position');
  });

  it('caps bull/bear evidence at top 5 by weight', () => {
    const t = composeThesis(
      mkSummary({
        last_price: 100,
        trend: { direction: 'up', strength: 0.9 },
        momentum: { rsi: 20, rsi_state: 'oversold', macd_cross: 'bullish', divergences: div('bullish') },
        levels: { support: [99.9], resistance: [110], poc: 98, vah: 105, val: 96 },
        patterns: [
          { kind: 'double_bottom', confidence: 0.7, points: PT },
          { kind: 'bull_flag', confidence: 0.6, points: PT },
          { kind: 'ascending_triangle', confidence: 0.5, points: PT },
        ],
      }),
    );
    expect(t.bull.length).toBeLessThanOrEqual(5);
    // sorted descending by weight
    for (let i = 1; i < t.bull.length; i++) expect(t.bull[i - 1].weight).toBeGreaterThanOrEqual(t.bull[i].weight);
  });

  it('symmetric triangle is a context note, not a directional point', () => {
    const t = composeThesis(
      mkSummary({ patterns: [{ kind: 'symmetric_triangle', confidence: 0.8, points: PT }] }),
    );
    expect(t.notes.some((n) => /symmetric triangle/i.test(n))).toBe(true);
    expect([...t.bull, ...t.bear].some((p) => p.factor === 'symmetric_triangle')).toBe(false);
  });

  it('channel_up is bullish evidence; channel_down bearish', () => {
    const up = composeThesis(
      mkSummary({ patterns: [{ kind: 'channel_up', confidence: 0.7, points: PT }] }),
    );
    expect(up.bull.some((p) => p.factor === 'channel_up')).toBe(true);

    const down = composeThesis(
      mkSummary({ patterns: [{ kind: 'channel_down', confidence: 0.7, points: PT }] }),
    );
    expect(down.bear.some((p) => p.factor === 'channel_down')).toBe(true);
  });

  it('rising_wedge is bearish evidence; falling_wedge bullish', () => {
    const rising = composeThesis(
      mkSummary({ patterns: [{ kind: 'rising_wedge', confidence: 0.7, points: PT }] }),
    );
    expect(rising.bear.some((p) => p.factor === 'rising_wedge')).toBe(true);

    const falling = composeThesis(
      mkSummary({ patterns: [{ kind: 'falling_wedge', confidence: 0.7, points: PT }] }),
    );
    expect(falling.bull.some((p) => p.factor === 'falling_wedge')).toBe(true);
  });

  it('cup_handle is bullish evidence', () => {
    const t = composeThesis(
      mkSummary({ patterns: [{ kind: 'cup_handle', confidence: 0.7, points: PT }] }),
    );
    expect(t.bull.some((p) => p.factor === 'cup_handle')).toBe(true);
  });

  it('triple_top is bearish evidence; triple_bottom bullish', () => {
    const top = composeThesis(
      mkSummary({ patterns: [{ kind: 'triple_top', confidence: 0.75, points: PT }] }),
    );
    expect(top.bear.some((p) => p.factor === 'triple_top')).toBe(true);

    const bottom = composeThesis(
      mkSummary({ patterns: [{ kind: 'triple_bottom', confidence: 0.75, points: PT }] }),
    );
    expect(bottom.bull.some((p) => p.factor === 'triple_bottom')).toBe(true);
  });

  it('rounding_bottom and gap_up are bullish; gap_down bearish', () => {
    const rb = composeThesis(
      mkSummary({ patterns: [{ kind: 'rounding_bottom', confidence: 0.7, points: PT }] }),
    );
    expect(rb.bull.some((p) => p.factor === 'rounding_bottom')).toBe(true);

    const up = composeThesis(
      mkSummary({ patterns: [{ kind: 'gap_up', confidence: 0.7, points: PT }] }),
    );
    expect(up.bull.some((p) => p.factor === 'gap_up')).toBe(true);

    const down = composeThesis(
      mkSummary({ patterns: [{ kind: 'gap_down', confidence: 0.7, points: PT }] }),
    );
    expect(down.bear.some((p) => p.factor === 'gap_down')).toBe(true);
  });

  it('harmonics carry their direction: bullish kinds → bull, bearish → bear', () => {
    const bull = composeThesis(
      mkSummary({ patterns: [{ kind: 'gartley_bullish', confidence: 0.8, points: PT }] }),
    );
    expect(bull.bull.some((p) => p.factor === 'gartley_bullish')).toBe(true);

    const bear = composeThesis(
      mkSummary({ patterns: [{ kind: 'abcd_bearish', confidence: 0.8, points: PT }] }),
    );
    expect(bear.bear.some((p) => p.factor === 'abcd_bearish')).toBe(true);
  });

  it('channel_flat awaits breakout: context note, no directional point', () => {
    const t = composeThesis(
      mkSummary({ patterns: [{ kind: 'channel_flat', confidence: 0.7, points: PT }] }),
    );
    expect(t.notes.some((n) => /channel flat — await breakout/.test(n))).toBe(true);
    expect([...t.bull, ...t.bear].some((p) => p.factor === 'channel_flat')).toBe(false);
  });
});

describe('composeThesis — real-data hardening (recency + measured move)', () => {
  // Stale point: before the recency cut (mkSummary first_ts = 1_700_000_000).
  const STALE = [{ ts: 1_700_100_000, price: 100, role: 'apex' }];

  it('ignores stale patterns, counts only recent ones', () => {
    const stale = composeThesis(
      mkSummary({ patterns: [{ kind: 'double_top', confidence: 0.95, points: STALE }] }),
    );
    expect(stale.bear.some((p) => p.factor === 'double_top')).toBe(false);

    const recent = composeThesis(
      mkSummary({ patterns: [{ kind: 'double_top', confidence: 0.95, points: PT }] }),
    );
    expect(recent.bear.some((p) => p.factor === 'double_top')).toBe(true);
  });

  it('bullish bias at highs (no overhead resistance) → measured-move long, not stand_aside', () => {
    const t = composeThesis(
      mkSummary({
        last_price: 100,
        trend: { direction: 'up', strength: 0.9 },
        momentum: { rsi: 28, rsi_state: 'oversold' },
        levels: { support: [98], resistance: [], poc: 95, vah: 0, val: 0 },
      }),
    );
    expect(t.verdict).toBe('long');
    expect(t.setup).not.toBeNull();
    expect(t.setup!.basis).toBe('measured move');
    expect(t.setup!.rr).toBeGreaterThanOrEqual(2);
    expect(t.setup!.target).toBeGreaterThan(t.setup!.entry);
  });

  it('clamps an absurdly-far k-means stop to an ATR stop (AAPL real-data case)', () => {
    // AAPL 1d 2026-06-06: entry 307.34, nearest k-means support 283.37 sits 23.97
    // below = 7.8% = 3.95x ATR (atr 6.07), price at highs (no overhead resistance).
    const t = composeThesis(
      mkSummary({
        last_price: 307.34,
        trend: { direction: 'up', strength: 0.9 },
        momentum: { rsi: 30, rsi_state: 'oversold' },
        levels: { support: [283.37], resistance: [], poc: 226.82, vah: 0, val: 195.8 },
        volatility: { atr: 6.07, atr_pct: 1.97 },
      }),
    );
    expect(t.verdict).toBe('long');
    // 23.97 > min(3x6.07=18.21, 8%x307.34=24.59) -> clamp to entry - 1.5x ATR.
    expect(t.setup!.stop).toBeCloseTo(307.34 - 1.5 * 6.07, 1); // ~298.24, not 283.37
    expect(t.setup!.basis).toMatch(/ATR stop/);
    // Tighter stop -> measured target rescales; rr stays >= 2, box compact.
    expect(t.setup!.rr).toBeGreaterThanOrEqual(2);
    expect(t.setup!.entry - t.setup!.stop).toBeLessThan(12); // ~9.1, far tighter than 23.97
  });

  it('divergence direction comes from the recent slice, not whole-history counts', () => {
    // by_kind says mostly bearish, but the recent slice is bullish → bull factor.
    const t = composeThesis(
      mkSummary({
        momentum: {
          divergences: {
            count: 9,
            by_kind: { bullish: 1, bearish: 8, hidden_bullish: 0, hidden_bearish: 0 },
            recent: [{ kind: 'bullish', indicator: 'rsi', ts: 1_717_280_000, price: 100 }],
          },
        },
      }),
    );
    expect(t.bull.some((p) => p.factor === 'bullish_divergence')).toBe(true);
    expect(t.bear.some((p) => p.factor === 'bearish_divergence')).toBe(false);
  });
});
