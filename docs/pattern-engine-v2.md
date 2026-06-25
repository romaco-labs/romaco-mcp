# Pattern Engine v2 — architecture notes

Engine refactor focused on measured performance and pattern-count scalability.
Golden rule throughout: **the LLM never reads candle arrays** — all compute
lives in the TypeScript backend, tools return verdicts (`trimPatternHits`,
compressed summaries; `gated_tools_default_size.test.ts` enforces <2 KB
payloads in CI).

## What v2 is (and is not)

The scan itself was never slow — 0.09 ms for 400 real daily candles, behind a
~300 ms data fetch. v2 attacks the two things that WERE real:

1. **Structural redundancy** — `detectPatterns`/`composeMarketSummary`/
   `analyzeSession` ran independently in 7+ tool call sites; the typical flow
   setup_chart → thesis → annotate → draw_pattern computed the identical scan
   four times.
2. **Pattern-count scaling** — adding pattern #27 meant writing a new
   geometry module by hand.

Rejected on engineering grounds (see the F0–F3 commit messages for the full
arguments): FFT/kernel denoising before pivot extraction (edge artifacts at
the decision edge, repaint/lag = look-ahead bias, pivots detached from
tradeable OHLC, silent recalibration of every ATR-anchored gate) and O(1)
signature hashing (sub-µs linear matching already; quantization cliffs at the
±tol `<=` boundaries; graded confidence needs continuous distances; geometry
recomputed for levels anyway).

## Layers

### Scan memo — `compression/scanCache.ts`

`memoScan(candles, slot, compute)` keyed by **candle-array identity**
(WeakMap). Every load path materializes a fresh `Candle[]` via JSON parsing,
so identity cannot collide and GC handles eviction. A content stamp
(length + last bar OHLC/ts) is re-checked per lookup so a future in-place
live-bar mutation degrades to a recompute, never a stale answer. Cached
values are **deep-frozen**: a consumer that mutates shared results throws
immediately. Consumers must copy (`filter`/`map`/`slice`) before reordering.

Memoization lives INSIDE the compression entry points
(`composeMarketSummary`, `analyzeSession`, `cachedDetectPatterns`), below the
`TODO(pro)` gateway forks. The anti-drift contract of `draw_pattern` /
`annotate` (geometry from re-detection, never agent-supplied) is preserved by
construction: the memo returns exactly what re-detection returns for those
candles.

### ScanContext — `compression/scanContext.ts`

Built once per `detectPatterns` run: shared ATR(14) series (was computed 3×
per scan), shared swings/zigzag, and **suffix extrema**
(`suffixMinLow[i]` / `suffixMaxHigh[i]` over `candles[i..N-1]`). Every hot
historical question in the engine is a suffix question, so:

- breach guard: "did any bar after completion touch invalidation/target?" →
  two O(1) comparisons per level (was O(N) per hit);
- gap fill: "did any later bar trade back through the edge?" → O(1) per gap
  (unfilled gaps in trending series each paid a scan to the end).

Comparisons only — booleans are bit-identical to the loops they replace; the
v1 loops remain in the same functions as the no-ctx fallback (and serve as
differential-test oracles). RMQ/sparse tables were evaluated and rejected:
no arbitrary-range query exists in the engine.

**Invariant: window-local structure stays window-local.** Channel/rounding
suffix windows deliberately re-derive their own swings and ATR from the slice
(Wilder warm-up from the window start differs from full-series values at the
same bars). Sharing ctx into those windows changes output — it is a
goldens-guarded no-goal.

### Cup pair-scan prune — `compression/cup.ts`, `fit.ts`

The F0 bench exposed `detectCupHandle` as 97% of the worst-case cost. Three
exact transformations (no gate or constant changed, differential oracle in
`cup_prune_parity.test.ts`): a dominance prune (right rims whose widest
possible cup still fails `handle ≤ span/2` can never hit), an incremental
running min for the cup bottom, and `quadFitLowsRange` (the parabola fit over
a candle range without materializing xs/ys arrays — allocation dominated the
arithmetic; identical accumulation order → bit-identical results).

### Template engine — `compression/templates/`

Ratio-defined pivot patterns are **data rows**, not modules: `schema.ts`
declares point-pair ratio constraints (anchor sets vs windows, both with the
v1 `<=` tolerance semantics), `engine.ts` is the single matcher, and
`harmonic_rows.ts` holds ABCD/Gartley/Bat (ported bit-exact, oracle-tested)
plus Butterfly/Crab (the first extension rows).

Emission order is contract: arity groups in declared order → windows
ascending → templates in declared order. The engine evaluates ALL templates
per window; correctness with v1's if/else dispatch holds because shipped
full gate-sets are pairwise exclusive — a property test sweeps the
(bRetrace, dRetrace) plane to keep it that way.

**Template authoring checklist (pattern #31+):**

1. Write the row in `harmonic_rows.ts` (or a sibling table): ratios as
   point-pair specs; pick `anchors` vs `window` deliberately — windows
   admit everything between their edges, anchors keep dead zones.
2. Confidence and level formulas are closures — keep them in the house scale
   (0.5 base / 0.85 cap) and decide invalidation from the family's structure
   (retracement → beyond-X; extension → exhaustion of the max valid leg).
3. Guards are per-template (`dInsideXa` vs `dBeyondX` exist already).
4. Add kinds to `PATTERN_KINDS`, thesis bull/bear sets, the drawing mapper
   switches, and the tool description.
5. Extend the disjointness property test if the new row's gates overlap an
   existing family's.
6. **Calibration is law**: run the row against the recorded real fixtures
   (and fresh symbols); review every hit by hand; freeze the observed count
   in a named test. Zero hits on strict gates is a correct outcome.

Doubles/H&S/triangles stay native detectors on purpose: their gates couple to
price levels (liveness bands, triple-consumes-double suppression) and raw
swings — porting buys no behavior and risks calibrated output.

## Truth layer

- `test/fixtures/real/` — 8 recorded daily fixtures (no network in tests);
  re-record via `scripts/record-fixtures.mjs` only deliberately, regenerating
  goldens in the same commit.
- `test/compression/__golden__/` — full detector output frozen per fixture;
  engine refactors must keep them byte-identical (per-V8-engine claim; CI
  should pin the Node major).
- Named sentinels: XOM's two W double-bottoms, TSLA's dead zombie iH&S, KO's
  calibrated channel, honest empties (AAPL/MSTR/JPM), frozen
  zero-extension-harmonics count.
- `npm run bench` — vitest bench; measure `detectPatterns` and
  `composeMarketSummary` separately (at N≥2000 the summary is dominated by
  `piecewiseLinear`, not patterns).

## Measured (N=400 real TSLA unless noted)

| metric | v1 | v2 |
|---|---|---|
| detectPatterns | 0.105 ms | 0.086 ms |
| detectPatterns, random walk N=5000 | 33.1 ms | 10.6 ms |
| detectPatterns, trending gappy N=5000 | 2.40 ms | 0.34 ms |
| 4-tool agent flow (same load) | 20.5 ms (4 full computes) | first call ~7 ms, then ~0.2 µs/hit |

## Deferred, with reasons

- **Streaming/incremental zigzag** — the memo makes per-session
  incrementality moot; belongs to a future gateway scanner with persistent
  per-symbol feeds. The zigzag is O(1)-amortized appendable; `ScanContext`
  is the natural seam.
- **`piecewiseLinear` O(N²) merge** — dominates `composeMarketSummary` at
  N≥2000 (159 ms at N=2000). Irrelevant at the N=400 the tools use; a
  parity-preserving optimization (memoize pair errors, recompute only the
  two pairs adjacent to each merge) is known if it ever matters.
- **Window densification** (CH_WINDOWS/RB_WINDOWS) — behavior change ⇒ its
  own real-data calibration exercise.
- **Sloped-line breach check for exempted wedges** — known honest residual
  of the breach guard (v1.2).
- **Approximate-signature retrieval** ("windows that look like now") — a
  product feature (retrieval, not detection); the only place hashing would
  ever belong.
