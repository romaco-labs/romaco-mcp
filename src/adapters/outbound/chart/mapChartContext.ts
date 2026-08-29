import {
  createChartId,
  normalizeOptionalChartSymbol,
  parseChartTimeframe,
  type ChartAlertState,
  type ChartContext,
  type ChartDrawingState,
  type ChartIdentity,
  type ChartIndicatorState,
} from '../../../domain/chart/model.js';

interface RawChartContext {
  symbol?: unknown;
  resolution?: unknown;
  visibleCandles?: unknown;
  totalCandles?: unknown;
  existingIndicators?: unknown;
  existingDrawings?: unknown;
  alerts?: unknown;
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
    const volume = candle.volume === undefined ? 0 : candle.volume;
    if (
      !finite(candle.timestamp)
      || !finite(candle.open)
      || !finite(candle.high)
      || !finite(candle.low)
      || !finite(candle.close)
      || !finite(volume)
      || volume < 0
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
      volume,
    };
  });
}

function optionalId(value: unknown, field: string): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'string' || !value) throw new Error(`Invalid chart ${field}.`);
  return value;
}

function array(value: unknown, field: string): unknown[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) throw new Error(`Chart ${field} must be an array.`);
  return value;
}

function record(value: unknown, field: string, index: number): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`Invalid chart ${field} at index ${index}.`);
  }
  return value as Record<string, unknown>;
}

function parseIndicators(value: unknown): ChartIndicatorState[] {
  return array(value, 'existingIndicators').map((candidate, index) => {
    const indicator = record(candidate, 'indicator', index);
    if (typeof indicator.name !== 'string' || !indicator.name) {
      throw new Error(`Invalid chart indicator name at index ${index}.`);
    }
    const params = indicator.params === undefined ? [] : indicator.params;
    if (!Array.isArray(params) || !params.every(finite)) {
      throw new Error(`Invalid chart indicator params at index ${index}.`);
    }
    return {
      ...(optionalId(indicator.id, 'indicator id') ? { id: indicator.id as string } : {}),
      type: indicator.name,
      params,
    };
  });
}

function parseDrawingPoints(value: unknown, index: number) {
  return array(value, `drawing points at index ${index}`).map((candidate, pointIndex) => {
    const point = record(candidate, 'drawing point', pointIndex);
    if (!finite(point.timestamp) || !finite(point.price)) {
      throw new Error(`Invalid chart drawing point at index ${index}.${pointIndex}.`);
    }
    return { timestamp: point.timestamp, price: point.price };
  });
}

function parseDrawings(value: unknown): ChartDrawingState[] {
  return array(value, 'existingDrawings').map((candidate, index) => {
    const drawing = record(candidate, 'drawing', index);
    if (typeof drawing.type !== 'string' || !drawing.type) {
      throw new Error(`Invalid chart drawing type at index ${index}.`);
    }
    return {
      ...(optionalId(drawing.id, 'drawing id') ? { id: drawing.id as string } : {}),
      type: drawing.type,
      points: parseDrawingPoints(drawing.points, index),
    };
  });
}

function parseAlerts(value: unknown): ChartAlertState[] {
  return array(value, 'alerts').map((candidate, index) => {
    const alert = record(candidate, 'alert', index);
    if (!finite(alert.price)) throw new Error(`Invalid chart alert price at index ${index}.`);
    const direction = alert.direction ?? 'cross';
    if (!['above', 'below', 'cross'].includes(direction as string)) {
      throw new Error(`Invalid chart alert direction at index ${index}.`);
    }
    return {
      ...(optionalId(alert.id, 'alert id') ? { id: alert.id as string } : {}),
      price: alert.price,
      direction: direction as ChartAlertState['direction'],
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
  if (context.totalCandles !== undefined && (!Number.isInteger(context.totalCandles) || (context.totalCandles as number) < 0)) {
    throw new Error('Invalid chart totalCandles.');
  }
  return {
    identity: mapChartIdentity(chartId, raw),
    visibleCandles: parseVisibleCandles(context.visibleCandles),
    ...(context.totalCandles === undefined ? {} : { totalCandles: context.totalCandles as number }),
    indicators: parseIndicators(context.existingIndicators),
    drawings: parseDrawings(context.existingDrawings),
    alerts: parseAlerts(context.alerts),
    raw,
  };
}
