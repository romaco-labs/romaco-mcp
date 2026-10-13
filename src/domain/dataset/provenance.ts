import type { Candle } from '../../compression/types.js';
import type { MarketDataSource, Timeframe } from './model.js';

export const DATASET_PROVENANCE_VERSION = 1 as const;

/**
 * Upper-bound bar length in seconds. Calendar months are handled separately;
 * `5d` uses seven calendar days because five trading days can span a weekend.
 */
const BAR_SECONDS: Record<Exclude<Timeframe, '1mo' | '3mo'>, number> = {
  '1m': 60, '2m': 120, '5m': 300, '15m': 900, '30m': 1800,
  '1h': 3600, '2h': 7200, '4h': 14400,
  '1d': 86_400, '5d': 7 * 86_400, '1w': 7 * 86_400,
};

export type PriceAdjustment = 'splits' | 'unknown';

export interface DatasetCoverage {
  barCount: number;
  /** Open time of the first bar, ms since epoch (UTC). */
  firstObservedAt: number | null;
  /** Open time of the last bar, ms since epoch (UTC). */
  lastObservedAt: number | null;
  /** Bars whose volume is zero; the source may report missing volume as zero. */
  zeroVolumeBars: number;
}

export interface LastBarAvailability {
  /** Bar open time, ms since epoch (UTC). */
  observedAt: number;
  /** Bar open plus one full interval: the latest the bar can close, not its exact close. */
  availableAt: number;
  /** True only when `availableAt` is not after `asOf`; false means it may still be forming. */
  complete: boolean;
}

export interface DatasetProvenance {
  version: typeof DATASET_PROVENANCE_VERSION;
  /** `sha256:<hex>` of the canonical dataset content (source, symbol, timeframe, OHLCV). */
  datasetHash: string;
  /** Information cut-off in ms since epoch: data acquired at this instant, nothing later. */
  asOf: number;
  timezone: 'UTC';
  timestampUnit: 'unix_seconds';
  priceAdjustment: PriceAdjustment;
  /** Neither source publishes data vintages, so revisions cannot be identified. */
  vintage: null;
  availableAtBasis: 'bar_open_plus_interval';
  lastBar: LastBarAvailability | null;
  coverage: DatasetCoverage;
}

export interface ProvenanceInput {
  source: MarketDataSource;
  symbol: string;
  timeframe: Timeframe;
  candles: readonly Candle[];
  fetchedAt: number;
}

/** Stable serialization hashed into `datasetHash`. Field order is part of the contract. */
export function canonicalDatasetContent(input: Omit<ProvenanceInput, 'fetchedAt'>): string {
  return JSON.stringify({
    v: DATASET_PROVENANCE_VERSION,
    source: input.source,
    symbol: input.symbol,
    timeframe: input.timeframe,
    candles: input.candles.map((c) => [c.timestamp, c.open, c.high, c.low, c.close, c.volume]),
  });
}

export function barAvailableAt(openSeconds: number, timeframe: Timeframe): number {
  if (timeframe === '1mo' || timeframe === '3mo') {
    const open = new Date(openSeconds * 1000);
    return Date.UTC(
      open.getUTCFullYear(),
      open.getUTCMonth() + (timeframe === '1mo' ? 1 : 3),
      open.getUTCDate(),
      open.getUTCHours(),
      open.getUTCMinutes(),
      open.getUTCSeconds(),
    );
  }
  return (openSeconds + BAR_SECONDS[timeframe]) * 1000;
}

export function describeProvenance(input: ProvenanceInput, datasetHash: string): DatasetProvenance {
  const first = input.candles[0];
  const last = input.candles[input.candles.length - 1];
  const asOf = input.fetchedAt;
  let lastBar: LastBarAvailability | null = null;
  if (last) {
    const availableAt = barAvailableAt(last.timestamp, input.timeframe);
    lastBar = { observedAt: last.timestamp * 1000, availableAt, complete: availableAt <= asOf };
  }
  return {
    version: DATASET_PROVENANCE_VERSION,
    datasetHash,
    asOf,
    timezone: 'UTC',
    timestampUnit: 'unix_seconds',
    // Yahoo chart OHLC is split-adjusted, not dividend-adjusted. Raw input is the host's.
    priceAdjustment: input.source === 'yfinance' ? 'splits' : 'unknown',
    vintage: null,
    availableAtBasis: 'bar_open_plus_interval',
    lastBar,
    coverage: {
      barCount: input.candles.length,
      firstObservedAt: first ? first.timestamp * 1000 : null,
      lastObservedAt: last ? last.timestamp * 1000 : null,
      zeroVolumeBars: input.candles.reduce((count, c) => count + (c.volume === 0 ? 1 : 0), 0),
    },
  };
}
