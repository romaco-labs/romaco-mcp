import type { Candle } from '../../compression/types.js';
import type {
  DatasetDraft,
  MarketDataSource,
  Timeframe,
} from '../../domain/dataset/model.js';

export interface LoadMarketDataRequest {
  source: MarketDataSource;
  symbol: string;
  timeframe: Timeframe;
  lookback?: number;
  rawCandles?: readonly Candle[];
}

export interface MarketDataPort {
  load(request: LoadMarketDataRequest): Promise<DatasetDraft>;
}
