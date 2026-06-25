import { describe, expect, it } from 'vitest';
import { detectPatterns } from '../../src/compression/patterns.js';
import { headShouldersCandles } from './fixtures.js';
import { realCandles } from './real_fixtures.js';

/**
 * Golden parity layer — the truth that every engine refactor answers to.
 *
 * The fixtures under test/fixtures/real/ are REAL daily candles recorded via
 * scripts/record-fixtures.mjs (no network in tests). The __golden__ snapshots
 * freeze the full detector output for each one. Engine-internal refactors
 * (scan context, shared ATR, suffix extrema, template ports) must keep these
 * BYTE-IDENTICAL — any diff is a behavior change and needs its own real-data
 * calibration, per the honest-signal principle.
 *
 * Bit-parity is claimed per JS engine (V8): all detector math is IEEE-754
 * arithmetic, deterministic for a given engine. CI pins the Node major.
 *
 * Re-recording fixtures moves the market under the goldens — only do it
 * deliberately, regenerating the snapshots in the same commit.
 */

const FIXTURE_SYMBOLS = ['TSLA', 'XOM', 'AAPL', 'MSTR', 'SPY', 'META', 'KO', 'JPM'] as const;

describe('golden parity — real market fixtures (recorded 2026-06-12)', () => {
  for (const symbol of FIXTURE_SYMBOLS) {
    it(`${symbol} 1d×400: detector output is frozen`, async () => {
      const hits = detectPatterns(realCandles(symbol));
      await expect(JSON.stringify(hits, null, 2)).toMatchFileSnapshot(
        `__golden__/${symbol}_1d_400.json`,
      );
    });
  }
});

describe('named sentinels — calibration cases the goldens encode', () => {
  it('XOM: exactly the two live W double bottoms (M/W calibration case)', () => {
    const dbs = detectPatterns(realCandles('XOM')).filter((h) => h.kind === 'double_bottom');
    expect(dbs).toHaveLength(2);
  });

  it('TSLA: the zombie iH&S stays dead — only the April survivor reports', () => {
    // The breach-guard case: a 0.88-confidence inverse H&S whose invalidation
    // (381.40) was wick-breached six days after completion. lastClose-only
    // liveness called it live; the guard killed it. The sole survivor is the
    // later, genuinely clean inverse H&S.
    const hits = detectPatterns(realCandles('TSLA'));
    expect(hits).toHaveLength(1);
    expect(hits[0].kind).toBe('inverse_head_shoulders');
  });

  it('KO: the calibrated channel_up still fires (channel usage-gate case)', () => {
    const kinds = detectPatterns(realCandles('KO')).map((h) => h.kind);
    expect(kinds).toContain('channel_up');
  });

  it('honest negatives: AAPL, MSTR, JPM report nothing rather than noise', () => {
    for (const symbol of ['AAPL', 'MSTR', 'JPM']) {
      expect(detectPatterns(realCandles(symbol))).toHaveLength(0);
    }
  });
});

describe('output-order contract', () => {
  it('hits emit in detector concatenation order (H&S family before gaps)', () => {
    // detectPatterns concatenates detector outputs in a fixed order
    // (patterns.ts). Tools and thesis read the array positionally enough that
    // a silent reorder — e.g. from a template-engine port — is a contract
    // break even when the SET of hits is identical.
    const kinds = detectPatterns(headShouldersCandles()).map((h) => h.kind);
    expect(kinds.indexOf('head_shoulders')).toBeGreaterThanOrEqual(0);
    const gapIdx = kinds.findIndex((k) => k === 'gap_down' || k === 'gap_up');
    if (gapIdx >= 0) {
      expect(kinds.indexOf('head_shoulders')).toBeLessThan(gapIdx);
    }
    // Pin the exact sequence for this fixture so any reorder is loud.
    expect(kinds).toMatchSnapshot();
  });
});
