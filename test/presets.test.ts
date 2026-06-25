import { describe, it, expect } from 'vitest';
import { PRESETS, PRESET_NAMES } from '../src/presets/index.js';

describe('ChartPresets', () => {
  it('all preset names are exported', () => {
    expect(PRESET_NAMES.length).toBeGreaterThan(0);
    expect(PRESET_NAMES).toContain('institutional');
    expect(PRESET_NAMES).toContain('trend_analysis');
    expect(PRESET_NAMES).toContain('scalping');
    expect(PRESET_NAMES).toContain('swing_trading');
    expect(PRESET_NAMES).toContain('momentum');
    expect(PRESET_NAMES).toContain('clean');
  });

  it.each(PRESET_NAMES)('%s preset has required fields', (name) => {
    const preset = PRESETS[name];
    expect(preset).toBeDefined();
    expect(preset.name).toBe(name);
    expect(typeof preset.description).toBe('string');
    expect(preset.description.length).toBeGreaterThan(10);
    expect(typeof preset.defaultTimeframe).toBe('string');
    expect(preset.lookback).toBeGreaterThan(0);
    expect(Array.isArray(preset.indicators)).toBe(true);
  });

  it('institutional preset has EMA and RSI', () => {
    const types = PRESETS.institutional.indicators.map(i => i.type);
    expect(types).toContain('EMA');
    expect(types).toContain('RSI');
  });

  it('scalping uses fast timeframe', () => {
    const tf = PRESETS.scalping.defaultTimeframe;
    expect(['1m', '2m', '5m', '15m']).toContain(tf);
  });

  it('clean preset has no indicators', () => {
    expect(PRESETS.clean.indicators).toHaveLength(0);
  });

  it('all indicator types are non-empty strings', () => {
    for (const preset of Object.values(PRESETS)) {
      for (const ind of preset.indicators) {
        expect(typeof ind.type).toBe('string');
        expect(ind.type.length).toBeGreaterThan(0);
        if (ind.params !== undefined) {
          expect(Array.isArray(ind.params)).toBe(true);
          for (const p of ind.params) expect(typeof p).toBe('number');
        }
      }
    }
  });
});
