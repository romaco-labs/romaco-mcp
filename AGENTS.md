# Purpose

This repository publishes `@romaco/mcp`, an open-source MCP server for
deterministic market analysis and optional `romaco-charts` control.

# Read first

- Architecture map: [`ARCHITECTURE.md`](./ARCHITECTURE.md)
- Accepted decision: [`docs/architecture/ADR-001-hexagonal-architecture.md`](./docs/architecture/ADR-001-hexagonal-architecture.md)
- Package/release contract: `package.json`, `.npmignore`, release tests, and the
  actual `npm pack` artifact.

# Product boundaries

- MCP is local/headless first. Browser chart bridge and remote gateway are
  optional adapters.
- `romaco-charts` owns chart execution and host-enforced write policy.
- `romaco.io` owns demo, docs, and conversion.
- SaaS is paused and must not become a core dependency.
- Do not copy ROA-I, WASM, institutional-data, billing, auth, pricing, or other
  proprietary/SaaS internals into this public repository.
- Public analysis uses approved public contracts such as `MarketSummary`.
- Promise: computed by code, interpreted by AI, optionally drawn on chart.
  Never claim zero hallucination risk.

# Architecture invariants

1. `compression/**` stays pure and imports only itself.
2. Domain imports domain/compression only.
3. Application imports application/domain/compression only.
4. Inbound adapters call use cases; they never import outbound adapters.
5. Outbound adapters implement application ports; they never import inbound
   adapters.
6. Tool handlers do not access repositories, gateway, chart bridge, market-data
   implementations, filesystem, or process state directly.
7. External payloads are validated at adapter boundaries.
8. Chart writes remain subject to host policy and explicit identity checks.
9. Legacy root modules and `src/tools/**` are temporary shims. Do not add new
   business logic there.

`test/architecture/dependency_rules.test.ts` enforces dependency direction.
Update architecture docs and that test together when a boundary changes.

# Development method

1. Analyze behavior and constraints.
2. Add characterization tests.
3. Change one small domain/application slice.
4. Adapt transport/infrastructure.
5. Run focused unit and contract tests.
6. Run `npm run build` and `npm test` before merge.
7. For tool selection, orchestration, recovery, or approval changes, add and run
   relevant agent evals. If an eval gate is not yet available, record that fact;
   never report it as passed.

# Trunk and releases

- `main` is stable trunk. Temporary branches carry one clear function.
- Prefer Conventional Commits: `feat:`, `fix:`, `refactor:`, `test:`, `docs:`,
  `chore:`.
- Do not merge failing build/tests/evals into `main`.
- Do not publish, bump version, create release commit, or tag without explicit
  user approval.
- Never use destructive Git commands to clean user work.
- Audit `npm pack --dry-run` before any approved release.
