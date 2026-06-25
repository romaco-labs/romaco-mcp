import { describe, it, expect, beforeEach } from 'vitest';
import { session } from '../src/session.js';
import type { LoadResponse } from '../src/data/types.js';
import type { Candle } from '../src/compression/types.js';

const candle = (ts: number, p: number): Candle => ({ timestamp: ts, open: p, high: p + 1, low: p - 1, close: p, volume: 1000 });

const fakeLoad: LoadResponse = {
  source: 'raw',
  symbol: 'TEST',
  timeframe: '1h',
  candles: [candle(1, 100), candle(2, 101)],
  fetched_at: Date.now(),
};

describe('SessionState', () => {
  beforeEach(() => {
    session.clear();
  });

  it('stores and retrieves last load', () => {
    expect(session.getLastLoad()).toBeNull();
    session.setLastLoad(fakeLoad);
    expect(session.getLastLoad()).toEqual(fakeLoad);
  });

  it('overwrites previous load', () => {
    session.setLastLoad(fakeLoad);
    const newer: LoadResponse = { ...fakeLoad, symbol: 'NEW', candles: [candle(3, 102)] };
    session.setLastLoad(newer);
    expect(session.getLastLoad()?.symbol).toBe('NEW');
  });

  it('clear() removes load', () => {
    session.setLastLoad(fakeLoad);
    session.clear();
    expect(session.getLastLoad()).toBeNull();
  });

  it('requireCandles returns candles when loaded', () => {
    session.setLastLoad(fakeLoad);
    expect(session.requireCandles()).toEqual(fakeLoad.candles);
  });

  it('requireCandles throws helpful error when no data', () => {
    expect(() => session.requireCandles()).toThrow(/romaco_load_candles/);
  });
});
