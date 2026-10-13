/**
 * Minimum candle counts before a reading is reported. Below these the series
 * is still warming up, so outputs report `null` / `insufficient_data` instead
 * of a neutral-looking default (RSI 50, ATR 0, volatility "stable").
 */

/** RSI(14) needs 14 changes, i.e. 15 closes. */
export const MIN_RSI_CANDLES = 15;

/**
 * MACD(12, 26, 9): the slow EMA and the signal EMA need 26 + 9 - 1 = 34 bars to
 * warm up, and crosses are checked over the last 3 bars plus one prior bar.
 */
export const MIN_MACD_CANDLES = 38;

/** ATR(14) needs 14 true ranges, i.e. 15 candles. */
export const MIN_ATR_CANDLES = 15;

/** Bollinger Bands(20). */
export const MIN_BOLLINGER_CANDLES = 20;

/** A thesis combines trend, momentum and volatility; it needs all of them warmed up. */
export const MIN_THESIS_CANDLES = MIN_MACD_CANDLES;

/** Volume-based levels need volume on at least this share of candles. */
export const MIN_VOLUME_COVERAGE = 0.5;
