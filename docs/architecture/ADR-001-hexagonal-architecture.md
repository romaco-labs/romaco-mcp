# ADR-001: Adopt incremental hexagonal architecture

**Status:** Accepted

**Date:** 2026-08-29

**Deciders:** Romaco maintainers

## Context

The deterministic analysis engine under `src/compression/**` is already pure,
but current MCP tool handlers also perform application orchestration and import
concrete process-wide singletons for session state, chart control, desired chart
state, market-data loading, and the optional remote gateway.

That coupling makes several required properties hard to guarantee:

- explicit dataset, analysis, and chart identity;
- cross-symbol and stale-analysis protection;
- idempotent chart writes and state reconciliation;
- consistent local/gateway analysis results;
- structured MCP outputs and actionable errors;
- isolated unit tests without spying on global instances.

Product boundaries also matter. `@romaco/mcp` is the open-source distribution
wedge; `romaco-charts` owns the SDK, chart runtime, and host write policy;
`romaco.io` serves demo/docs/conversion. Paused SaaS infrastructure and private
ROA-I, WASM, or institutional internals cannot become MCP core dependencies.

## Decision

Adopt ports-and-adapters incrementally:

```text
MCP adapter -> application use case -> outbound port -> concrete adapter
                         |
                         v
                domain + compression
```

Migration uses a strangler pattern, not a rewrite. Existing public tool names
and compatible inputs remain stable. `src/compression/**` remains in place.
Temporary root modules and `src/tools/**` may re-export new implementations
until their callers migrate.

New domain records carry branded `DatasetId` and `AnalysisId` values.
Application ports define dataset/analysis repositories, market-data loading,
chart control, and the optional analysis gateway. One future composition root
will create concrete adapters and inject them into use cases.

Deterministic calculations live in domain modules. MCP handlers validate input,
call an application use case, and present output; they do not contain business
math or access outbound implementations.

## Options considered

### A. Keep current modules and add more singleton helpers

| Dimension | Assessment |
|---|---|
| Initial effort | Low |
| Regression risk | Low initially |
| Test isolation | Poor |
| Identity/idempotency guarantees | Poor |
| Long-term coupling | High |

Rejected. It preserves the failure mode this change must remove.

### B. Rewrite into a complete layered tree in one change

| Dimension | Assessment |
|---|---|
| Initial effort | High |
| Regression risk | High |
| Architectural purity | High |
| Reviewability | Poor |

Rejected. Twenty-seven tools, bridge recovery, compression budgets, and release
contracts create too much simultaneous regression risk.

### C. Incremental hexagonal migration

| Dimension | Assessment |
|---|---|
| Initial effort | Medium |
| Regression risk | Controlled |
| Test isolation | High |
| Reviewability | High |
| Temporary duplication | Medium |

Accepted. Each workflow moves behind ports with characterization tests before
legacy shims disappear.

## Dependency rules

- Compression cannot import outside `src/compression/**`.
- Domain can import domain and compression only.
- Application can import application, domain, and compression only.
- Inbound adapters cannot import outbound adapters.
- Outbound adapters cannot import inbound adapters.
- MCP SDK, Zod transport schemas, WebSocket, HTTP, filesystem, process env, and
  OS launching stay in adapters/bootstrap.
- External responses are validated before entering application code.

These are CI-enforced structural rules, not prompt-only guidance.

## Consequences

Positive:

- core workflows become testable with in-memory fakes;
- chart/data identity checks become central and fail closed;
- local and optional gateway behavior share stable application contracts;
- MCP v2/output-schema work no longer leaks into domain behavior;
- future transports can reuse use cases.

Negative:

- more explicit DTO mapping and files;
- temporary compatibility shims during migration;
- concrete runtime wiring must become explicit;
- partial migration requires discipline to prevent new legacy imports.

## Explicit non-goals

- no DI framework, event bus, CQRS, or generic repository framework;
- no abstraction around every compression detector or pure helper;
- no MCP-server wrapper port or generic `executeAny(unknown)` port;
- no persistent database or multi-tenant session model yet;
- no SaaS, billing, private model orchestration, or proprietary engine code;
- no claim that deterministic numbers eliminate AI interpretation risk.

## Follow-up

1. Add domain identities, application ports, and in-memory repository adapters.
2. Move headless workflows behind use cases.
3. Isolate chart bridge and desired-state reconciliation behind ports.
4. Enforce chart/dataset identity and atomic idempotent drawing replacement.
5. Add structured MCP output contracts, security adapters, traces, and evals.

## Implementation note — 2026-08-29

Reconnect desired-state recovery now implements items 3 and 4 incrementally:

- `ReconcileChartStateUseCase` depends on `ChartPort` and
  `ChartDesiredStatePort` only;
- `ChartReadyReconciliationAdapter` converts authenticated/legacy bridge
  `ready` events into use-case execution at composition root;
- indicator, drawing, group, and alert replay is scoped by exact chart identity;
- group replay stays atomic and idempotent;
- removal and resource-ID refresh are expressed through desired-state port,
  preventing reconnect resurrection after successful host removal.

Root `chartState` remains temporary in-memory storage behind
`LegacyChartJournal`; application reconciliation no longer imports it.
