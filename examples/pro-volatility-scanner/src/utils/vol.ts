import type { CandleData } from 'romaco-charts';

/**
 * Volatility metrics computed client-side from the SAME candles on screen.
 * Nothing here is decorative — these are the real numbers a desk would read
 * before deciding a name is "wild" enough to scan for harmonic geometry.
 */
export interface VolStats {
  /** Wilder ATR(14) in price units. */
  atr: number;
  /** ATR as a percentage of last close — the cross-symbol comparable. */
  atrPct: number;
  /** Annualized realized volatility from 20d close-to-close log returns. */
  realizedVol: number;
  /** Last close. */
  last: number;
  /** % change over the last session. */
  dayChangePct: number;
}

const TRADING_DAYS = 252;

/** Wilder's ATR — the smoothing the thesis engine's stop math also assumes. */
function wilderAtr(candles: CandleData[], period = 14): number {
  if (candles.length < period + 1) return NaN;
  const trs: number[] = [];
  for (let i = 1; i < candles.length; i++) {
    const c = candles[i];
    const prevClose = candles[i - 1].close;
    const tr = Math.max(
      c.high - c.low,
      Math.abs(c.high - prevClose),
      Math.abs(c.low - prevClose),
    );
    trs.push(tr);
  }
  // Seed with simple average of the first `period` TRs, then Wilder-smooth.
  let atr = trs.slice(0, period).reduce((a, b) => a + b, 0) / period;
  for (let i = period; i < trs.length; i++) {
    atr = (atr * (period - 1) + trs[i]) / period;
  }
  return atr;
}

/** Annualized realized vol from close-to-close log returns over `window` days. */
function realizedVol(candles: CandleData[], window = 20): number {
  if (candles.length < window + 1) return NaN;
  const slice = candles.slice(-(window + 1));
  const rets: number[] = [];
  for (let i = 1; i < slice.length; i++) {
    rets.push(Math.log(slice[i].close / slice[i - 1].close));
  }
  const mean = rets.reduce((a, b) => a + b, 0) / rets.length;
  const variance =
    rets.reduce((a, b) => a + (b - mean) ** 2, 0) / (rets.length - 1);
  return Math.sqrt(variance) * Math.sqrt(TRADING_DAYS);
}

export function computeVolStats(candles: CandleData[]): VolStats {
  const last = candles[candles.length - 1]?.close ?? NaN;
  const prev = candles[candles.length - 2]?.close ?? last;
  const atr = wilderAtr(candles);
  return {
    atr,
    atrPct: (atr / last) * 100,
    realizedVol: realizedVol(candles) * 100,
    last,
    dayChangePct: ((last - prev) / prev) * 100,
  };
}
