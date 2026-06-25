import type { Candle, PatternHit, Swing } from './types.js';
import { detectTemplates } from './templates/engine.js';
import { HARMONIC_MAX_SWINGS, HARMONIC_TEMPLATES } from './templates/harmonic_rows.js';

/**
 * Harmonic patterns — pure Fibonacci arithmetic on zigzag pivots.
 *
 * Honest-signal contract: a leg ratio either sits inside its Fibonacci window
 * (± FIB_TOL) or the candidate is discarded SILENTLY. There is no "almost a
 * Gartley"; the math fits or there is no pattern. Confidence only grades how
 * close a passing pattern sits to the ideal ratios.
 *
 * Since v2 the detectors live as DATA: templates/harmonic_rows.ts declares
 * each family's ratio gates and level formulas, and templates/engine.ts is
 * the one generic matcher. This delegate keeps the public signature. The
 * port is oracle-tested against the v1 implementations (bit-equal output,
 * including confidence and emission order).
 */
export function detectHarmonics(candles: Candle[], zz: Swing[], atr: number): PatternHit[] {
  void candles;
  return detectTemplates(zz, atr, HARMONIC_TEMPLATES, HARMONIC_MAX_SWINGS);
}
