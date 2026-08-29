import type { Candle } from '../compression/types.js';
import type { DatasetId } from '../domain/dataset/model.js';

export type DataSourceName = 'yfinance' | 'raw';

/** Canonical timeframe strings supported across sources */
export type Timeframe =
  | '1m' | '2m' | '5m' | '15m' | '30m'
  | '1h' | '2h' | '4h'
  | '1d' | '5d' | '1w' | '1mo' | '3mo';

export interface LoadRequest {
  source: DataSourceName;
  symbol: string;
  timeframe: Timeframe;
  /** Number of candles to fetch (default 500, max varies by source) */
  lookback?: number;
  /** For source='raw', the user-provided candles */
  rawCandles?: Candle[];
}

export interface LoadResponse {
  datasetId?: DatasetId;
  source: DataSourceName;
  symbol: string;
  timeframe: Timeframe;
  candles: Candle[];
  fetched_at: number;
}

export interface DataSource {
  name: DataSourceName;
  fetchCandles(request: LoadRequest): Promise<Candle[]>;
}
