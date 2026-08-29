import {
  createChartId,
  normalizeOptionalChartSymbol,
  parseChartTimeframe,
  type ChartContext,
  type ChartIdentity,
} from '../../../domain/chart/model.js';

interface RawChartContext {
  symbol?: unknown;
  resolution?: unknown;
  visibleCandles?: unknown;
}

function finite(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function parseVisibleCandles(value: unknown): ChartContext['visibleCandles'] {
  if (value === undefined) return undefined;
  if (!Array.isArray(value)) throw new Error('Chart visibleCandles must be an array.');
  return value.map((candidate, index) => {
    if (typeof candidate !== 'object' || candidate === null || Array.isArray(candidate)) {
      throw new Error(`Invalid chart candle at index ${index}.`);
    }
    const candle = candidate as Record<string, unknown>;
    if (
      !finite(candle.timestamp)
      || !finite(candle.open)
      || !finite(candle.high)
      || !finite(candle.low)
      || !finite(candle.close)
      || !finite(candle.volume)
      || candle.volume < 0
      || candle.high < Math.max(candle.open, candle.low, candle.close)
      || candle.low > Math.min(candle.open, candle.high, candle.close)
    ) {
      throw new Error(`Invalid chart candle at index ${index}: expected finite ordered OHLCV.`);
    }
    return {
      timestamp: candle.timestamp,
      open: candle.open,
      high: candle.high,
      low: candle.low,
      close: candle.close,
      volume: candle.volume,
    };
  });
}

export function mapChartIdentity(chartId: string, raw: unknown): ChartIdentity {
  const context = (raw ?? {}) as RawChartContext;
  return {
    chartId: createChartId(chartId),
    symbol: normalizeOptionalChartSymbol(context.symbol),
    timeframe: parseChartTimeframe(context.resolution),
  };
}

export function mapChartContext(chartId: string, raw: unknown): ChartContext {
  const context = (raw ?? {}) as RawChartContext;
  return {
    identity: mapChartIdentity(chartId, raw),
    visibleCandles: parseVisibleCandles(context.visibleCandles),
    raw,
  };
}
