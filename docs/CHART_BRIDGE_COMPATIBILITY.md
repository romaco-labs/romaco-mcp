# Chart bridge compatibility

Headless analysis does not require `romaco-charts`. Live reads and ordinary
chart actions require `<McpBridge />`. Atomic thesis and pattern annotations
require a chart host that implements `replaceAgentDrawingGroup`.

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

## Compatibility behavior

| Capability | Host requirement | Older host behavior |
|---|---|---|
| Headless load/analysis/thesis | none | works |
| Concise chart context and pane reads | `<McpBridge />` identity/context support | explicit bridge error |
| Basic indicator/drawing/alert actions | corresponding chart actions | host rejection |
| `romaco_annotate`, atomic pattern drawing | `replaceAgentDrawingGroup` + stable IDs | fails closed |

No package version is claimed here until the chart release containing the full
atomic contract is published and consumer-tested.
