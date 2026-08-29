import type { Timeframe } from '../../domain/dataset/model.js';

export interface ChartPresetIndicator {
  type: string;
  params?: number[];
}

export interface ChartPresetDefinition {
  name: string;
  defaultTimeframe: Timeframe;
  lookback: number;
  indicators: readonly ChartPresetIndicator[];
}

export interface ChartPresetCatalog {
  names(): readonly string[];
  get(name: string): ChartPresetDefinition;
}
