import { describe, it, expect } from 'vitest';
import { atr, bollingerBands, detectBollingerSqueeze, volatilitySummary } from '../../src/compression/volatility.js';
import { uptrendCandles, sidewaysCandles } from './fixtures.js';

describe('atr', () => {
  it('returns NaN for first `period` entries', () => {
    const series = atr(uptrendCandles(30), 14);
    for (let i = 0; i < 14; i++) expect(Number.isNaN(series[i])).toBe(true);
    expect(Number.isFinite(series[14])).toBe(true);
  });

  it('ATR is non-negative', () => {
    const series = atr(uptrendCandles(50), 14);
    for (const v of series) {
      if (!Number.isNaN(v)) expect(v).toBeGreaterThanOrEqual(0);
    }
  });

  it('higher volatility → higher ATR', () => {
    const low = atr(sidewaysCandles(50, 100, 0.2));
    const high = atr(sidewaysCandles(50, 100, 5));
    expect(high[high.length - 1]).toBeGreaterThan(low[low.length - 1]);
  });
});

describe('bollingerBands', () => {
  it('upper >= middle >= lower for valid indices', () => {
    const bb = bollingerBands(uptrendCandles(50));
    for (let i = 19; i < bb.upper.length; i++) {
      expect(bb.upper[i]).toBeGreaterThanOrEqual(bb.middle[i]);
      expect(bb.middle[i]).toBeGreaterThanOrEqual(bb.lower[i]);
    }
  });

  it('first 19 entries are NaN with default period 20', () => {
    const bb = bollingerBands(uptrendCandles(30));
    for (let i = 0; i < 19; i++) expect(Number.isNaN(bb.middle[i])).toBe(true);
  });
});

describe('detectBollingerSqueeze', () => {
  it('returns boolean', () => {
    const sq = detectBollingerSqueeze(sidewaysCandles(50, 100, 0.5));
    expect(typeof sq).toBe('boolean');
  });
});

describe('volatilitySummary', () => {
  it('returns full structure', () => {
    const s = volatilitySummary(uptrendCandles(50));
    expect(s).toHaveProperty('atr');
    expect(s).toHaveProperty('atr_pct');
    expect(s).toHaveProperty('bb_squeeze');
    expect(s).toHaveProperty('bb_width_pct');
    expect(s).toHaveProperty('state');
    expect(['expanding', 'contracting', 'stable']).toContain(s.state);
  });

  it('atr_pct is non-negative', () => {
    const s = volatilitySummary(uptrendCandles(50));
    expect(s.atr_pct).toBeGreaterThanOrEqual(0);
  });

  it('handles empty', () => {
    const s = volatilitySummary([]);
    expect(s.atr).toBe(0);
    expect(s.state).toBe('stable');
  });
});
