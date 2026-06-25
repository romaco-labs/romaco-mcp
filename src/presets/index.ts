import type { Timeframe } from '../data/types.js';

export interface IndicatorConfig {
  type: string;
  params?: number[];
}

export interface ChartPreset {
  name: string;
  description: string;
  defaultTimeframe: Timeframe;
  lookback: number;
  indicators: IndicatorConfig[];
}

export const PRESETS: Record<string, ChartPreset> = {
  trend_analysis: {
    name: 'trend_analysis',
    description: 'Classic trend following. EMA 20/50/200 + RSI + Volume. Daily timeframe.',
    defaultTimeframe: '1d',
    lookback: 500,
    indicators: [
      { type: 'EMA', params: [20] },
      { type: 'EMA', params: [50] },
      { type: 'EMA', params: [200] },
      { type: 'RSI', params: [14] },
      { type: 'VOL' },
    ],
  },

  scalping: {
    name: 'scalping',
    description: 'Short-term momentum. EMA 9/21 + MACD + Volume. 5m timeframe.',
    defaultTimeframe: '5m',
    lookback: 300,
    indicators: [
      { type: 'EMA', params: [9] },
      { type: 'EMA', params: [21] },
      { type: 'MACD', params: [12, 26, 9] },
      { type: 'VOL' },
    ],
  },

  swing_trading: {
    name: 'swing_trading',
    description: 'Multi-day swings. EMA 50/200 + MACD + RSI + ATR. 4h timeframe.',
    defaultTimeframe: '4h',
    lookback: 500,
    indicators: [
      { type: 'EMA', params: [50] },
      { type: 'EMA', params: [200] },
      { type: 'MACD', params: [12, 26, 9] },
      { type: 'RSI', params: [14] },
      { type: 'ATR', params: [14] },
    ],
  },

  institutional: {
    name: 'institutional',
    description: 'Institutional setup. EMA 20/50 + RSI + MACD + Volume. 1h timeframe.',
    defaultTimeframe: '1h',
    lookback: 500,
    indicators: [
      { type: 'EMA', params: [20] },
      { type: 'EMA', params: [50] },
      { type: 'RSI', params: [14] },
      { type: 'MACD', params: [12, 26, 9] },
      { type: 'VOL' },
    ],
  },

  momentum: {
    name: 'momentum',
    description: 'Breakout momentum. EMA 9/21 + RSI + Bollinger + Volume. 15m timeframe.',
    defaultTimeframe: '15m',
    lookback: 300,
    indicators: [
      { type: 'EMA', params: [9] },
      { type: 'EMA', params: [21] },
      { type: 'RSI', params: [14] },
      { type: 'BOLL', params: [20] },
      { type: 'VOL' },
    ],
  },

  clean: {
    name: 'clean',
    description: 'Candles only, no indicators. Good starting point before adding your own.',
    defaultTimeframe: '1h',
    lookback: 200,
    indicators: [],
  },
};

export const PRESET_NAMES = Object.keys(PRESETS) as (keyof typeof PRESETS)[];
