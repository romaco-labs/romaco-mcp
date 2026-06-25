import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock yahoo-finance2 default export with a class whose `chart` method we control.
const chartMock = vi.fn();
vi.mock('yahoo-finance2', () => ({
  default: class {
    chart = chartMock;
    constructor() {
      /* noop */
    }
  },
}));

// Import AFTER mock so the module under test picks up the mocked class.
const { yfinance } = await import('../../src/data/sources/yfinance.js');

function makeQuotes(
  timestamps: number[],
  opens: (number | null)[],
  highs: (number | null)[],
  lows: (number | null)[],
  closes: (number | null)[],
  volumes: (number | null)[],
) {
  return timestamps.map((ts, i) => ({
    date: new Date(ts * 1000),
    open: opens[i],
    high: highs[i],
    low: lows[i],
    close: closes[i],
    volume: volumes[i],
  }));
}

describe('yfinance source (yahoo-finance2)', () => {
  beforeEach(() => {
    chartMock.mockReset();
  });

  afterEach(() => {
    chartMock.mockReset();
  });

  it('parses yahoo-finance2 array response into Candle[]', async () => {
    chartMock.mockResolvedValueOnce({
      quotes: makeQuotes(
        [1000, 2000, 3000],
        [100, 101, 102],
        [101, 102, 103],
        [99, 100, 101],
        [100.5, 101.5, 102.5],
        [10000, 11000, 12000],
      ),
    });

    const candles = await yfinance.fetchCandles({
      source: 'yfinance',
      symbol: 'AAPL',
      timeframe: '1h',
      lookback: 10,
    });

    expect(candles.length).toBe(3);
    expect(candles[0]).toEqual({
      timestamp: 1000,
      open: 100,
      high: 101,
      low: 99,
      close: 100.5,
      volume: 10000,
    });
    expect(candles[2].close).toBe(102.5);
  });

  it('respects lookback by slicing the last N candles', async () => {
    const n = 10;
    chartMock.mockResolvedValueOnce({
      quotes: makeQuotes(
        Array.from({ length: n }, (_, i) => 1000 + i * 60),
        Array.from({ length: n }, (_, i) => 100 + i),
        Array.from({ length: n }, (_, i) => 101 + i),
        Array.from({ length: n }, (_, i) => 99 + i),
        Array.from({ length: n }, (_, i) => 100.5 + i),
        Array.from({ length: n }, () => 10000),
      ),
    });

    const candles = await yfinance.fetchCandles({
      source: 'yfinance',
      symbol: 'AAPL',
      timeframe: '1h',
      lookback: 3,
    });
    expect(candles.length).toBe(3);
    expect(candles[0].timestamp).toBe(1000 + 7 * 60);
  });

  it('translates 429-ish errors to a clear actionable message', async () => {
    chartMock.mockRejectedValueOnce(new Error('Yahoo returned 429 Too Many Requests'));
    await expect(
      yfinance.fetchCandles({ source: 'yfinance', symbol: 'AAPL', timeframe: '1h' }),
    ).rejects.toThrow(/rate-limited/i);
  });

  it('treats messages mentioning "rate" as rate-limited', async () => {
    chartMock.mockRejectedValueOnce(new Error('Service unavailable — please reduce your rate'));
    await expect(
      yfinance.fetchCandles({ source: 'yfinance', symbol: 'AAPL', timeframe: '1h' }),
    ).rejects.toThrow(/rate-limited/i);
  });

  it('propagates unrelated errors verbatim', async () => {
    chartMock.mockRejectedValueOnce(new Error('No quote data found for symbol BADSYM'));
    await expect(
      yfinance.fetchCandles({ source: 'yfinance', symbol: 'BADSYM', timeframe: '1h' }),
    ).rejects.toThrow(/No quote data found/);
  });

  it('skips quotes with null OHLC', async () => {
    chartMock.mockResolvedValueOnce({
      quotes: makeQuotes(
        [1000, 2000, 3000],
        [100, null, 102],
        [101, null, 103],
        [99, null, 101],
        [100.5, null, 102.5],
        [10000, null, 12000],
      ),
    });

    const candles = await yfinance.fetchCandles({
      source: 'yfinance',
      symbol: 'AAPL',
      timeframe: '1h',
    });
    expect(candles.length).toBe(2);
    expect(candles.every((c) => c.timestamp !== 2000)).toBe(true);
  });

  it('aggregates 1h candles into 2h buckets when timeframe=2h', async () => {
    chartMock.mockResolvedValueOnce({
      quotes: makeQuotes(
        [1000, 4600, 8200, 11800],
        [100, 101, 102, 103],
        [101, 102, 103, 104],
        [99, 100, 101, 102],
        [100.5, 101.5, 102.5, 103.5],
        [10000, 11000, 12000, 13000],
      ),
    });

    const candles = await yfinance.fetchCandles({
      source: 'yfinance',
      symbol: 'AAPL',
      timeframe: '2h',
    });
    expect(candles.length).toBe(2);
    expect(candles[0].open).toBe(100);
    expect(candles[0].close).toBe(101.5);
    expect(candles[0].volume).toBe(21000);
    expect(candles[0].high).toBe(102);
    expect(candles[0].low).toBe(99);
  });

  it('calls yf.chart with period1/period2 Date and the mapped interval', async () => {
    chartMock.mockResolvedValueOnce({
      quotes: makeQuotes([1000], [100], [101], [99], [100.5], [10000]),
    });

    await yfinance.fetchCandles({
      source: 'yfinance',
      symbol: 'AAPL',
      timeframe: '1d',
      lookback: 100,
    });

    expect(chartMock).toHaveBeenCalledWith(
      'AAPL',
      expect.objectContaining({
        interval: '1d',
        period1: expect.any(Date),
        period2: expect.any(Date),
        return: 'array',
      }),
    );
  });

  it('uses 1h interval for synthetic 4h timeframe (aggregation handled in-source)', async () => {
    chartMock.mockResolvedValueOnce({
      quotes: makeQuotes(
        [0, 3600, 7200, 10800, 14400, 18000, 21600, 25200],
        [100, 100, 100, 100, 100, 100, 100, 100],
        [101, 101, 101, 101, 101, 101, 101, 101],
        [99, 99, 99, 99, 99, 99, 99, 99],
        [100.5, 100.5, 100.5, 100.5, 100.5, 100.5, 100.5, 100.5],
        [1000, 1000, 1000, 1000, 1000, 1000, 1000, 1000],
      ),
    });

    await yfinance.fetchCandles({
      source: 'yfinance',
      symbol: 'AAPL',
      timeframe: '4h',
    });

    expect(chartMock).toHaveBeenCalledWith(
      'AAPL',
      expect.objectContaining({ interval: '1h' }),
    );
  });
});
