# Chart bridge compatibility

Headless analysis does not require `romaco-charts`. Live reads and ordinary
chart actions require `<McpBridge />`. Atomic thesis and pattern annotations
require a chart host that implements `replaceAgentDrawingGroup`.

Approval tokens are MCP-side capabilities. They never bypass host
`actionPolicy`; host authorization remains an independent second barrier.

## Atomic action contract

MCP sends one host action:

```json
{
  "action": "replaceAgentDrawingGroup",
  "groupId": "romaco-mcp/thesis",
  "idempotencyKey": "analysisId:chartId:viewport:thesis-v1",
  "drawings": [
    {
      "drawingType": "horizontalLine",
      "points": [{ "timestamp": 1700000000, "price": 150 }]
    }
  ]
}
```

Successful hosts return stable artifact identities:

```json
{
  "success": true,
  "data": {
    "drawingIds": ["drawing_1"]
  }
}
```

Host responsibilities:

- enforce host write policy before mutation;
- validate every drawing before changing state;
- replace only the agent-owned `groupId` as one transaction;
- preserve user-owned drawings and unrelated agent groups;
- make same-key/same-payload retries idempotent;
- reject same-key/different-payload conflicts;
- return drawing IDs in input order;
- persist/reconcile the atomic group using chart identity, symbol, and timeframe.

MCP verifies `chartId`, symbol, and timeframe before sending the action. It
records desired state only after host success. Transport failure, identity
mismatch, or host rejection produces an MCP error; MCP never degrades to a
remove-then-add sequence because that can leave half-applied state.

## Approved drawing clear

`romaco_clear_drawings` previews only desired-state groups in reserved
`romaco-mcp/*` namespace. After one-time approval, MCP sends
`replaceAgentDrawingGroup` with empty `drawings` for each approved group and
exact expected identity. It never sends global `clearDrawings`. Hosts must keep
reserved agent groups isolated from user drawings and reject identity drift.
`romaco_add_drawing` always records the same ownership boundary: omitted
`groupId` becomes `romaco-mcp/manual`, and non-reserved explicit groups fail
before chart access. Thus manual agent drawings remain attributable and clearable.

Multiple approved groups are separate atomic replacements. If later group
fails, MCP returns `PARTIAL_APPLY`, removes only successful groups from journal,
and requires fresh preview/approval for remainder.

## Paper position boundary

`romaco_open_paper_position` sends only `openPaperLong` or `openPaperShort` to
chart host after scoped one-time approval. These actions are simulation/UI
state, not broker routing. Host must enforce paper-only behavior and its normal
write policy.

MCP binds caller `idempotencyKey` to exact chart identity and payload. Completed
same-key/same-payload retry returns stored receipt; changed payload fails closed.
Store is process-local and memory-only. It prevents duplicate successful calls
while process survives. Ambiguous failure makes key terminally indeterminate;
MCP denies automatic retry until manual chart reconciliation and fresh-key
approval. It cannot guarantee crash-safe exactly-once semantics. No claim of
durable trade execution exists.

## Approved alert clear

`romaco_clear_alerts` previews stable alert IDs for exact `chartId + symbol +
timeframe`, then issues a one-time approval scoped to that immutable plan. After
approval, MCP sends one `removeAlert` action per approved ID with
`expectedIdentity`. It never sends global `clearAlerts`. Chart or alert-plan
drift fails before writes; partial apply reports successful and failed IDs and
requires fresh preview/approval for remaining alerts.

## Compatibility behavior

| Capability | Host requirement | Older host behavior |
|---|---|---|
| Headless load/analysis/thesis | none | works |
| Concise chart context and pane reads | `<McpBridge />` identity/context support | explicit bridge error |
| Basic indicator/drawing/alert actions | corresponding chart actions | host rejection |
| `romaco_annotate`, atomic pattern drawing | `replaceAgentDrawingGroup` + stable IDs | fails closed |
| Approved Romaco drawing clear | empty `replaceAgentDrawingGroup` + identity policy | fails closed; never global clear |
| Approved paper position | paper action + host `actionPolicy` | fails closed; no real trading fallback |

No package version is claimed here until the chart release containing the full
atomic contract is published and consumer-tested.

Successful legacy indicator hosts that omit `indicatorId` remain compatible:
MCP journals the applied desired state and returns `status: partial` with
`RESOURCE_ID_UNAVAILABLE`. It never reports a failed write or invites blind
retry after the host already mutated.
