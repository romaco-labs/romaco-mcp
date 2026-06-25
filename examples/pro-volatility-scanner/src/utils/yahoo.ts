import type { CandleData } from 'romaco-charts';

/**
 * Loads real daily OHLCV from the dev-server endpoint (see vite.config.ts).
 * Server-side it uses yahoo-finance2 — the same library @romaco/mcp uses —
 * so the thesis the analyst computes lines up with the candles on screen.
 *
 * Volatility names (MSTR, TSLA, COIN…) gap and whip, so we pull a deep
 * lookback: harmonic XABCD / measured-move geometry needs the swing history.
 */
export async function loadYahooCandles(
  symbol: string,
  lookback = 400,
): Promise<CandleData[]> {
  const res = await fetch(
    `/api/candles?symbol=${encodeURIComponent(symbol)}&lookback=${lookback}`,
  );
  const json = await res.json();
  if (!res.ok) throw new Error(json?.error ?? `HTTP ${res.status} for ${symbol}`);
  if (!Array.isArray(json) || json.length === 0) throw new Error(`No data for ${symbol}`);
  return json as CandleData[];
}
