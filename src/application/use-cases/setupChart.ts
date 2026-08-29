import { composeMarketSummary } from '../../compression/summary.js';
import type { MarketSummary } from '../../compression/types.js';
import type { ChartIdentity } from '../../domain/chart/model.js';
import type { DatasetRecord, MarketDataSource, Timeframe } from '../../domain/dataset/model.js';
import type { Candle } from '../../compression/types.js';
import type { ChartPort } from '../ports/chart.js';
import type { ChartJournalPort } from '../ports/chartJournal.js';
import type { ChartPresetCatalog } from '../ports/chartPresetCatalog.js';
import type { LoadDatasetUseCase } from './loadDataset.js';

export interface SetupChartRequest {
  symbol: string;
  presetName?: string;
  timeframe?: Timeframe;
  source?: MarketDataSource;
  lookback?: number;
  rawCandles?: readonly Candle[];
}

export interface SetupIndicatorResult {
  type: string;
  params?: number[];
  success: boolean;
  resourceId?: string;
  error?: string;
}

export interface SetupChartResult {
  dataset: DatasetRecord;
  summary: MarketSummary;
  presetName: string;
  liveStatus: 'clean' | 'disconnected' | 'matched' | 'identity_mismatch' | 'unavailable';
  chartIdentity?: ChartIdentity;
  indicators: SetupIndicatorResult[];
  liveError?: string;
}

export class SetupChartUseCase {
  constructor(
    private readonly loader: Pick<LoadDatasetUseCase, 'execute'>,
    private readonly chart: ChartPort,
    private readonly presets: ChartPresetCatalog,
    private readonly journal: ChartJournalPort,
  ) {}

  async execute(request: SetupChartRequest): Promise<SetupChartResult> {
    const preset = this.presets.get(request.presetName ?? 'institutional');
    const timeframe = request.timeframe ?? preset.defaultTimeframe;
    const dataset = await this.loader.execute({
      source: request.source ?? 'yfinance',
      symbol: request.symbol,
      timeframe,
      lookback: request.lookback ?? preset.lookback,
      rawCandles: request.rawCandles,
    });
    const summary = composeMarketSummary([...dataset.candles]);

    if (preset.indicators.length === 0) {
      return { dataset, summary, presetName: preset.name, liveStatus: 'clean', indicators: [] };
    }
    if (!this.chart.isConnected()) {
      return { dataset, summary, presetName: preset.name, liveStatus: 'disconnected', indicators: [] };
    }

    let identity: ChartIdentity;
    try {
      identity = await this.chart.getIdentity();
    } catch (error) {
      return {
        dataset,
        summary,
        presetName: preset.name,
        liveStatus: 'unavailable',
        indicators: [],
        liveError: error instanceof Error ? error.message : String(error),
      };
    }
    if (identity.symbol !== dataset.symbol || identity.timeframe !== dataset.timeframe) {
      return {
        dataset,
        summary,
        presetName: preset.name,
        liveStatus: 'identity_mismatch',
        chartIdentity: identity,
        indicators: [],
      };
    }

    const indicators: SetupIndicatorResult[] = [];
    for (const indicator of preset.indicators) {
      try {
        const result = await this.chart.execute(
          { action: 'addIndicator', indicatorType: indicator.type, params: indicator.params },
          { expectedIdentity: identity },
        );
        const resourceId = result.resourceIds?.[0];
        this.journal.recordIndicator(indicator, identity, resourceId);
        indicators.push({ ...indicator, success: true, resourceId });
      } catch (error) {
        indicators.push({
          ...indicator,
          success: false,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    return {
      dataset,
      summary,
      presetName: preset.name,
      liveStatus: 'matched',
      chartIdentity: identity,
      indicators,
    };
  }
}
