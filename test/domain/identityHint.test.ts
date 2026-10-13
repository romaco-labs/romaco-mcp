import { describe, expect, it } from 'vitest';
import { MISSING_TIMEFRAME_HINT, withIdentityHint } from '../../src/domain/chart/model.js';

describe('chart identity upgrade hint', () => {
  it('asks to upgrade romaco-charts when only the timeframe is missing', () => {
    expect(withIdentityHint('Write refused.', { symbol: 'AAPL' })).toBe(`Write refused. ${MISSING_TIMEFRAME_HINT}`);
    expect(MISSING_TIMEFRAME_HINT).toMatch(/romaco-charts to 1\.0\.3 or later/);
  });

  it('leaves the message alone when the symbol is missing or identity is complete', () => {
    expect(withIdentityHint('Write refused.', {})).toBe('Write refused.');
    expect(withIdentityHint('Write refused.', { symbol: 'AAPL', timeframe: '1h' })).toBe('Write refused.');
  });
});
