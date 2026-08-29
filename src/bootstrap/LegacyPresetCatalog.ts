import type {
  ChartPresetCatalog,
  ChartPresetDefinition,
} from '../application/ports/chartPresetCatalog.js';
import { PRESETS, PRESET_NAMES } from '../presets/index.js';

export class LegacyPresetCatalog implements ChartPresetCatalog {
  names(): readonly string[] {
    return PRESET_NAMES;
  }

  get(name: string): ChartPresetDefinition {
    const preset = PRESETS[name];
    if (!preset) throw new Error(`Unknown chart preset: ${name}.`);
    return preset;
  }
}
