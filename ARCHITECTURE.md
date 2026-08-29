# Architecture

`@romaco/mcp` uses incremental hexagonal architecture. New behavior enters
through an inbound adapter, runs in an application use case, and reaches I/O
only through an outbound port.

```text
MCP client
    |
    v
adapters/inbound/mcp
    |
    v
application/use-cases -----> application/ports
    |                              |
    v                              v
domain + compression       adapters/outbound
```

## Product boundaries

- `@romaco/mcp` is the open-source distribution wedge. Headless/local analysis
  is the primary path. Browser chart control and the remote gateway are optional
  adapters.
- `romaco-charts` is the chart SDK and product. It owns chart execution,
  browser integration, and host-enforced write policy.
- `romaco.io` is the demo, documentation, and conversion surface.
- The SaaS business is paused. MCP core must not depend on SaaS availability,
  credentials, infrastructure, billing, or private orchestration.
- WASM, institutional data, ROA-I internals, and other proprietary advantages
  stay outside this repository. An approved public gateway contract may be
  consumed only through an optional outbound adapter.
- No current tool transmits candles to the optional analysis gateway. Environment
  variables alone never authorize remote egress; a future adapter needs an
  explicit authorization contract and boundary validation first.

Product promise: values are computed by deterministic code, interpreted by AI,
then optionally drawn on the chart. Do not claim that interpretation has zero
hallucination risk. Chart writes remain subject to host policy.

## Layers

### Domain

`src/domain/**` contains transport-neutral records, value objects, invariants,
and deterministic calculations. It may depend on `src/compression/**`, which is
the existing pure market-analysis core.

### Application

`src/application/**` coordinates use cases. Ports describe required external
capabilities. Application code must not import MCP, WebSocket, HTTP, filesystem,
environment, or concrete adapter modules.

### Adapters

`src/adapters/inbound/**` validates transport input, invokes a use case, and
maps its result to the transport contract. `src/adapters/outbound/**` implements
application ports for persistence, market data, chart control, gateways, and OS
integration.

Optional browser bridge stays in `src/adapters/outbound/chart/**`:

- `bridgeProtocol.ts`: wire DTOs and versioning;
- `bridgeAuth.ts`: pairing proofs, nonce validation, replay defense;
- `WebSocketBridgeTransport.ts`: loopback lifecycle and request correlation.

Environment parsing and construction stay in `src/bootstrap/**`.
`src/bridge.ts` remains a compatibility shim only.

### Composition root

Runtime construction belongs in `src/bootstrap/**` and process startup belongs
in `src/index.ts`. Only the composition root chooses concrete adapters.

## Enforced dependency direction

1. `compression` imports only `compression`.
2. `domain` imports only `domain` or `compression`.
3. `application` imports only `application`, `domain`, or `compression`.
4. Inbound adapters may import application/domain/compression, never outbound
   adapters.
5. Outbound adapters may import application/domain/compression, never inbound
   adapters.
6. Domain and application never return MCP `content`, `isError`, or
   `structuredContent` values.
7. Tool handlers never access storage, gateway, chart bridge, or market-data
   implementations directly.
8. External payloads are validated at their adapter boundary.

`test/architecture/dependency_rules.test.ts` enforces these rules for new
layers plus `compression/**`. Root modules and `src/tools/**` are temporary
legacy shims; they remain outside the rule until migrated.

## State identity

Datasets, analyses, and charts have explicit identities:

```text
DatasetRecord: datasetId + symbol + timeframe + source + candles
AnalysisRecord: analysisId + datasetId + provider + exact output
ChartIdentity: chartId + symbol + timeframe/datasetId when available
```

Active-record lookup exists for backward compatibility, not as durable workflow
identity. New composed workflows should pass `datasetId` and `analysisId`.
Price- or timestamp-bound chart writes must fail closed when chart identity does
not match analysis identity.

High-impact writes use scoped, one-time approval capabilities at MCP inbound
boundary. Approval does not replace host policy. Paper-position idempotency is a
process-local adapter contract, not durable exactly-once execution. Drawing
clear plans target only reserved agent groups and preserve user-owned state.

## Change workflow

1. Characterize existing behavior with tests.
2. Add or change domain/application behavior through ports.
3. Implement adapter mapping.
4. Keep legacy shim until all callers migrate.
5. Run focused tests, full test suite, and build.
6. Remove shim only in a dedicated cleanup change.

Decision record: [ADR-001](docs/architecture/ADR-001-hexagonal-architecture.md).
