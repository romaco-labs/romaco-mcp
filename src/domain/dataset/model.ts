import type { Candle } from '../../compression/types.js';

declare const datasetIdBrand: unique symbol;

export type DatasetId = string & { readonly [datasetIdBrand]: 'DatasetId' };

export type MarketDataSource = 'yfinance' | 'raw';

export type Timeframe =
  | '1m' | '2m' | '5m' | '15m' | '30m'
  | '1h' | '2h' | '4h'
  | '1d' | '5d' | '1w' | '1mo' | '3mo';

export interface DatasetDraft {
  source: MarketDataSource;
  symbol: string;
  timeframe: Timeframe;
  candles: readonly Candle[];
  fetchedAt: number;
}

export interface DatasetRecord extends DatasetDraft {
  datasetId: DatasetId;
}

export function createDatasetId(value: string): DatasetId {
  const normalized = value.trim();
  if (!normalized) throw new Error('DatasetId cannot be empty.');
  return normalized as DatasetId;
}
