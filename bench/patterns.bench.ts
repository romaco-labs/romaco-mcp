import { readFileSync } from 'node:fs';
import { bench, describe } from 'vitest';
import { analyzeSession } from '../src/compression/analyze.js';
import { detectPatterns } from '../src/compression/patterns.js';
import { cachedDetectPatterns } from '../src/compression/scanCache.js';
import { composeMarketSummary } from '../src/compression/summary.js';
import type { Candle } from '../src/compression/types.js';

/**
 * Engine benchmarks — the truth layer for every performance claim.
 *
 * detectPatterns and composeMarketSummary are measured SEPARATELY: at large N
 * the summary is dominated by piecewiseLinear's bottom-up merge (trend.ts),
 * not by the pattern scan — lumping them misattributes cost.
 *
 * The "trending gappy" series is adversarial for v1 gaps.ts: each qualifying
 * unfilled gap pays a forward scan to the end of the series (the engine's one
 * genuinely quadratic path). Suffix extrema (ScanContext) collapse it to O(1)
 * per gap.
 */

function realCandles(symbol: string): Candle[] {
  const url = new URL(`../test/fixtures/real/${symbol}_1d_400.json`, import.meta.url);
  return JSON.parse(readFileSync(url, 'utf-8')) as Candle[];
}

/** Deterministic PRNG — benches must measure the same series every run. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function randomWalk(n: number, seed: number): Candle[] {
  const rnd = mulberry32(seed);
  const out: Candle[] = [];
  let close = 100;
  for (let i = 0; i < n; i++) {
    const open = close;
    close = Math.max(1, close + (rnd() - 0.5) * 2);
    const high = Math.max(open, close) + rnd() * 0.6;
    const low = Math.min(open, close) - rnd() * 0.6;
    out.push({ timestamp: 1_600_000_000 + i * 86_400, open, high, low, close, volume: 1000 });
  }
  return out;
}

/** Strong uptrend with an unfilled momentum gap every ~10 bars. */
function trendingGappy(n: number, seed: number): Candle[] {
  const rnd = mulberry32(seed);
  const out: Candle[] = [];
  let close = 100;
  for (let i = 0; i < n; i++) {
    const gap = i > 0 && i % 10 === 0 ? close * 0.02 : 0; // jumps clear of trailing ATR
    const open = close + gap;
    close = open + close * 0.004 + (rnd() - 0.3) * close * 0.004;
    const high = Math.max(open, close) * (1 + rnd() * 0.001);
    const low = Math.min(open, close) * (1 - rnd() * 0.001);
    out.push({ timestamp: 1_600_000_000 + i * 86_400, open, high, low, close, volume: 1000 });
  }
  return out;
}

const TSLA = realCandles('TSLA');
const WALK_1K = randomWalk(1000, 42);
const WALK_5K = randomWalk(5000, 42);
const GAPPY_5K = trendingGappy(5000, 7);
const WALK_2K = randomWalk(2000, 42);

describe('detectPatterns', () => {
  bench('real TSLA 1d (N=400)', () => {
    detectPatterns(TSLA);
  });
  bench('random walk (N=1000)', () => {
    detectPatterns(WALK_1K);
  });
  bench('random walk (N=5000)', () => {
    detectPatterns(WALK_5K);
  });
  bench('trending gappy (N=5000) — adversarial for gap fill scans', () => {
    detectPatterns(GAPPY_5K);
  });
});

describe('composeMarketSummary', () => {
  bench('real TSLA 1d (N=400) — fresh array per call (uncached path)', () => {
    composeMarketSummary([...TSLA]);
  });
  bench('random walk (N=2000) — piecewiseLinear dominates here', () => {
    composeMarketSummary([...WALK_2K]);
  });
});

describe('agent flow: setup_chart → thesis → annotate → draw_pattern (N=400 real)', () => {
  // The flow every conversation pays. Fresh arrays simulate the pre-memo
  // engine (each tool recomputed); the same array measures steady-state with
  // the scan memo (first iteration fills, the rest are identity hits).
  bench('without memo — 4 independent computes', () => {
    composeMarketSummary([...TSLA]); // setup_chart
    analyzeSession([...TSLA]); //        thesis
    analyzeSession([...TSLA]); //        annotate
    cachedDetectPatterns([...TSLA]); //  draw_pattern
  });
  bench('with memo — same loaded array', () => {
    composeMarketSummary(TSLA);
    analyzeSession(TSLA);
    analyzeSession(TSLA);
    cachedDetectPatterns(TSLA);
  });
});
