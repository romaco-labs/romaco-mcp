// Static mirror of the drawing-template catalog exposed by the romaco-charts
// engine. Kept here so the headless `romaco_list_templates` tool can describe
// the full surface to AI agents without needing the browser bridge to be
// connected.
//
// If you add a template to `src/drawings/templates/`, also add it here.

export type TemplateCategory =
  | 'structure'
  | 'zones'
  | 'fibonacci'
  | 'positions'
  | 'measure'
  | 'annotation'
  | 'shapes'
  | 'harmonics'
  | 'gann'
  | 'alerts';

export interface TemplateDescriptor {
  name: string;
  category: TemplateCategory;
  /** Required point count; `null` = variable (brush, path, elliottWaveAny). */
  points: number | null;
  description: string;
}

export const DRAWING_TEMPLATE_CATALOG: TemplateDescriptor[] = [
  // structure
  { name: 'trendline', category: 'structure', points: 2, description: 'Line joining two points (no extension).' },
  { name: 'horizontalLine', category: 'structure', points: 1, description: 'Full-width horizontal line at a price.' },
  { name: 'horizontalRay', category: 'structure', points: 1, description: 'Horizontal ray extending to one side.' },
  { name: 'verticalLine', category: 'structure', points: 1, description: 'Full-height vertical line at a timestamp.' },
  { name: 'verticalSegment', category: 'structure', points: 2, description: 'Vertical segment between two prices at the same time.' },
  { name: 'verticalRay', category: 'structure', points: 1, description: 'Vertical ray (downward by default).' },
  { name: 'parallelChannel', category: 'structure', points: 3, description: 'Two parallel trendlines plus a midline.' },

  // zones
  { name: 'rectangle', category: 'zones', points: 2, description: 'Order block / supply or demand zone.' },
  { name: 'brush', category: 'zones', points: null, description: 'Freehand brush stroke.' },
  { name: 'path', category: 'zones', points: null, description: 'Market structure path with HH/HL/LH/LL labels.' },

  // fibonacci
  { name: 'fibRetracement', category: 'fibonacci', points: 2, description: 'Fibonacci retracement (low→high or high→low).' },
  { name: 'fibExtension', category: 'fibonacci', points: 3, description: 'Fibonacci extension targets (1, 1.272, 1.618…).' },
  { name: 'fibCircle', category: 'fibonacci', points: 2, description: 'Concentric Fibonacci circles.' },
  { name: 'fibSpiral', category: 'fibonacci', points: 2, description: 'Golden spiral with reference squares.' },
  { name: 'fibFan', category: 'fibonacci', points: 2, description: 'Fibonacci fan lines from an origin point.' },

  // positions
  { name: 'longPosition', category: 'positions', points: 3, description: 'Entry / stop-loss / take-profit box with R:R label.' },
  { name: 'shortPosition', category: 'positions', points: 3, description: 'Short entry / SL / TP box.' },

  // measure
  { name: 'dateRange', category: 'measure', points: 2, description: 'Date range with % change and duration.' },
  { name: 'ruler', category: 'measure', points: 2, description: 'Angle-aware measurement ruler.' },
  { name: 'volumeProfile', category: 'measure', points: 2, description: 'Volume profile POC / VAH / VAL for a range.' },

  // annotation
  { name: 'text', category: 'annotation', points: 1, description: 'Free text annotation.' },
  { name: 'elliottWave', category: 'annotation', points: 6, description: 'Five-wave impulse (0-1-2-3-4-5).' },
  { name: 'elliottWave3', category: 'annotation', points: 4, description: 'Three-wave corrective (0-A-B-C).' },
  { name: 'elliottWave8', category: 'annotation', points: 9, description: 'Full cycle: 5 impulse + 3 corrective.' },
  { name: 'elliottWaveAny', category: 'annotation', points: null, description: 'Variable-length labeled wave sequence.' },

  // shapes
  { name: 'circle', category: 'shapes', points: 2, description: 'Circle defined by center + radius point.' },
  { name: 'triangle', category: 'shapes', points: 3, description: 'Triangle by three vertices.' },
  { name: 'arrow', category: 'shapes', points: 2, description: 'Arrow with computed head.' },
  { name: 'parallelogram', category: 'shapes', points: 3, description: 'Parallelogram (4th vertex auto-derived).' },

  // harmonics
  { name: 'abcd', category: 'harmonics', points: 4, description: 'ABCD harmonic pattern.' },
  { name: 'xabcd', category: 'harmonics', points: 5, description: 'XABCD (Gartley / Bat / Butterfly / Crab).' },

  // gann
  { name: 'gannBox', category: 'gann', points: 2, description: 'Gann square with 8 levels and diagonals.' },

  // alerts
  { name: 'priceAlert', category: 'alerts', points: 1, description: 'Horizontal dashed alert line with bell icon.' },
];

export function listDrawingTypeNames(): string[] {
  return DRAWING_TEMPLATE_CATALOG.map((t) => t.name);
}
