import YahooFinance from 'yahoo-finance2';
import type { Candle } from '../../compression/types.js';
import type { DataSource, LoadRequest, Timeframe } from '../types.js';

// yahoo-finance2 handles the cookie/crumb handshake Yahoo requires for query2.
// This eliminates the 429s caused by our previous raw fetch approach.
const yf = new YahooFinance({ validation: { logErrors: false } });

// yahoo-finance2 supports 1h natively. 2h/4h still need aggregation from 1h.
const TF_MAP: Record<Timeframe, string> = {
  '1m': '1m', '2m': '2m', '5m': '5m', '15m': '15m', '30m': '30m',
  '1h': '1h', '2h': '1h', '4h': '1h',
  '1d': '1d', '5d': '5d', '1w': '1wk', '1mo': '1mo', '3mo': '3mo',
};

const TF_MINUTES: Record<Timeframe, number> = {
  '1m': 1, '2m': 2, '5m': 5, '15m': 15, '30m': 30,
  '1h': 60, '2h': 120, '4h': 240,
  '1d': 1440, '5d': 7200, '1w': 10080, '1mo': 43200, '3mo': 129600,
};

function pickStart(tf: Timeframe, lookback: number): Date {
  // 1.5x margin so weekend/holiday gaps still produce `lookback` bars after slicing.
  const ms = TF_MINUTES[tf] * 60_000 * lookback * 1.5;
  return new Date(Date.now() - ms);
}

/**
 * Aggregates 1h candles into 2h or 4h candles, grouped by fixed UTC-aligned time
 * windows (floor(timestamp / bucketSeconds)). Because buckets are keyed by
 * absolute time — not array position — boundaries are stable regardless of the
 * fetch window's start hour, and bars from different sessions never merge across
 * overnight or weekend gaps (a gap simply lands the next bar in a later bucket).
 */
function aggregate(candles: Candle[], bucketSeconds: number): Candle[] {
  const out: Candle[] = [];
  let cur: Candle | null = null;
  let curBucket = -1;
  for (const c of candles) {
    const bucket = Math.floor(c.timestamp / bucketSeconds);
    if (cur === null || bucket !== curBucket) {
      if (cur) out.push(cur);
      cur = { ...c, timestamp: bucket * bucketSeconds };
      curBucket = bucket;
    } else {
      cur.high = Math.max(cur.high, c.high);
      cur.low = Math.min(cur.low, c.low);
      cur.close = c.close;
      cur.volume += c.volume;
    }
  }
  if (cur) out.push(cur);
  return out;
}

interface QuoteLike {
  date: Date;
  open: number | null;
  high: number | null;
  low: number | null;
  close: number | null;
  volume: number | null;
  adjclose?: number | null;
}

class YFinanceSource implements DataSource {
  readonly name = 'yfinance' as const;

  async fetchCandles(req: LoadRequest): Promise<Candle[]> {
    const lookback = req.lookback ?? 500;
    const interval = TF_MAP[req.timeframe];

    let quotes: QuoteLike[];
    try {
      const result = await yf.chart(req.symbol, {
        period1: pickStart(req.timeframe, lookback),
        period2: new Date(),
        interval: interval as Parameters<typeof yf.chart>[1]['interval'],
        return: 'array',
      });
      quotes = (result as { quotes: QuoteLike[] }).quotes;
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes('429') || /rate/i.test(msg)) {
        throw new Error(
          `Yahoo Finance rate-limited the request. Wait 30–60s and retry, or pass source:"raw" with your own candles.`,
        );
      }
      throw err;
    }

    const candles: Candle[] = [];
    for (const q of quotes) {
      if (q.open == null || q.high == null || q.low == null || q.close == null) continue;
      candles.push({
        timestamp: Math.floor(q.date.getTime() / 1000),
        open: q.open,
        high: q.high,
        low: q.low,
        close: q.close,
        volume: q.volume ?? 0,
      });
    }

    let out = candles;
    if (req.timeframe === '2h') out = aggregate(candles, 2 * 60 * 60);
    else if (req.timeframe === '4h') out = aggregate(candles, 4 * 60 * 60);

    return out.slice(-lookback);
  }
}

export const yfinance = new YFinanceSource();
