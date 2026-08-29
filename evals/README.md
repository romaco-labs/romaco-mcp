# Offline evaluation contract

This directory contains deterministic MCP conformance workflows, not a claim that
all 28 scenarios execute an autonomous model today.

- `runnable`: workflow and every referenced deterministic grader execute locally.
- `planned`: scenario is specified but excluded from success-rate denominator.
- runnable failure or missing runnable implementation: non-zero exit.
- `evidence-conformance`: declared numeric evidence appears in structured tool
  output. It does not grade model prose.
- `claims`: planned grader for numeric claims extracted from an actual agent final
  answer.

`npm run eval:offline` reports numerator, denominator, failed, harness error, and
planned counts. Use `node scripts/run-offline-evals.mjs --require-all` when planned
scenarios must also block the gate.
