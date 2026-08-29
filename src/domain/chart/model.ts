import type { Candle } from '../../compression/types.js';
import type { DatasetId, Timeframe } from '../dataset/model.js';

declare const chartIdBrand: unique symbol;

export type ChartId = string & { readonly [chartIdBrand]: 'ChartId' };

export function createChartId(value: string): ChartId {
  const normalized = value.trim();
  if (!normalized) throw new Error('ChartId cannot be empty.');
  return normalized as ChartId;
}

export interface ChartIdentity {
  chartId: ChartId;
  symbol?: string;
  timeframe?: Timeframe;
  datasetId?: DatasetId;
}

export interface ChartDrawingStyle {
  color?: string;
  lineWidth?: number;
  lineStyle?: 'solid' | 'dashed' | 'dotted';
  opacity?: number;
  fillColor?: string;
}

export interface ChartDrawingPoint {
  timestamp: number;
  price: number;
}

export type ChartCommand =
  | { action: 'addIndicator'; indicatorType: string; params?: number[] }
  | {
      action: 'addDrawing';
      drawingType: string;
      points: ChartDrawingPoint[];
      label?: string;
      style?: ChartDrawingStyle;
      paneId?: string;
      groupId?: string;
    }
  | { action: 'zoomIn'; factor?: number }
  | { action: 'zoomOut'; factor?: number }
  | { action: 'resetView' }
  | { action: 'addAlert'; price: number; options?: { direction?: 'above' | 'below' | 'cross'; note?: string } }
  | { action: 'clearDrawings' }
  | { action: 'removeDrawingsByGroup'; groupId: string }
  | { action: 'openPaperLong'; quantity: number; stopLoss?: number; takeProfit?: number }
  | { action: 'openPaperShort'; quantity: number; stopLoss?: number; takeProfit?: number }
  | { action: 'getIndicatorValues'; indicatorId?: string; indicatorName?: string }
  | { action: 'goToTimestamp'; timestamp: number }
  | { action: 'listPanes' }
  | { action: 'removeAlert'; alertId: string }
  | { action: 'clearAlerts' }
  | { action: 'removeIndicator'; indicatorId: string }
  | { action: 'setPriceRange'; min: number; max: number };

export interface ChartCommandResult {
  success: boolean;
  error?: string;
  data?: unknown;
  resourceIds?: readonly string[];
}

export interface ChartContext {
  identity: ChartIdentity;
  visibleCandles?: readonly Candle[];
  raw?: unknown;
}

export interface ReplaceDrawingGroupCommand {
  groupId: string;
  drawings: readonly Extract<ChartCommand, { action: 'addDrawing' }>[];
  expectedIdentity: ChartIdentity;
  idempotencyKey: string;
}

export interface ChartSnapshot {
  format: 'png' | 'jpeg';
  dataUrl: string;
}
