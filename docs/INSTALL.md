# @romaco/mcp — Installation & Configuration

## What it is

`@romaco/mcp` is an MCP (Model Context Protocol) server that lets Claude, Cursor, or any MCP-compatible AI agent run market analysis and control a trading chart through plain-language prompts.

## Prerequisites

- **Node.js >= 20** (the server is published as ESM and run with `npx`)
- **An MCP client** — for example Claude Code, Claude Desktop, or Cursor

You do **not** need a global install. The examples below run the server on demand with `npx`.

## Install & wire-up

### Claude Code

Add the server with a single command:

```bash
claude mcp add romaco -- npx -y @romaco/mcp
```

Or commit it to your project so the whole team shares it. Create a `.mcp.json` at your project root:

```json
{
  "mcpServers": {
    "romaco": {
      "command": "npx",
      "args": ["-y", "@romaco/mcp"]
    }
  }
}
```

### Claude Desktop

Open (or create) the Claude Desktop config file:

- **macOS:** `~/Library/Application Support/Claude/claude_desktop_config.json`

Add the same server block:

```json
{
  "mcpServers": {
    "romaco": {
      "command": "npx",
      "args": ["-y", "@romaco/mcp"]
    }
  }
}
```

Save the file and **restart Claude Desktop** so it picks up the new server.

### Cursor and other stdio clients

`@romaco/mcp` speaks the standard MCP **stdio** transport, so any stdio-capable client works. Point your client's MCP config at the same command:

```json
{
  "mcpServers": {
    "romaco": {
      "command": "npx",
      "args": ["-y", "@romaco/mcp"]
    }
  }
}
```

## 30-second first run (headless, no browser)

The headless tools run entirely on your machine and pull free price data from yfinance — no chart, no browser required. Once the server is wired up, just ask your agent in natural language:

```text
Analyze AAPL on the daily timeframe and give me a long/short thesis with entry, stop, and target.
```

Your agent will load candles, run the analysis, and return a compact verdict (`long`, `short`, or `stand_aside`) with levels. Every response is a small, structured feature set — raw OHLCV is never dumped into the conversation.

Other things you can ask out of the box, all headless:

```text
Find the key support and resistance levels for NVDA, 1h.
Detect chart patterns on TSLA daily.
Size a position for SPY with a 1% account risk and my stop.
```

## Optional: live-chart control

Beyond headless analysis, the agent can drive a **live** browser chart — add indicators and drawings, set alerts, capture snapshots, open paper positions, and more. This requires the chart library and a small bridge component.

**Requirements**

- `romaco-charts >= 1.0.0-beta.6`
- The bridge talks to the MCP server over **WebSocket port 7399** (configurable — see below)

Mount `<McpBridge />` next to your `<TradingTerminal />` and pass it the terminal's ref:

```tsx
import { useRef } from 'react';
import { TradingTerminal, McpBridge, type TradingTerminalRef } from 'romaco-charts/react';

export function Terminal() {
  const chartRef = useRef<TradingTerminalRef | null>(null);
  const bridgeToken = getBridgeTokenFromRuntime();

  return (
    <>
      <TradingTerminal ref={chartRef} symbol="AAPL" />
      <McpBridge chartRef={chartRef} security={{ mode: 'paired', token: bridgeToken }} />
    </>
  );
}
```

With the bridge connected, the chart-bridge tools become live. If the bridge is not mounted, those tools simply have nothing to talk to — the headless tools keep working regardless.

Four high-impact tools are intentionally two-step:

- `romaco_annotate`: approval scope is exact `analysisId`.
- `romaco_clear_drawings`: first call previews exact chart identity and current
  `romaco-mcp/*` groups. Retry with returned `planId` and `approvalToken`. Tool
  never sends global `clearDrawings`, so user-owned drawings remain untouched.
- `romaco_clear_alerts`: first call previews exact chart identity and stable
  alert IDs. Retry with returned `planId` and `approvalToken`. Tool removes each
  approved ID separately and never sends global `clearAlerts`.
- `romaco_open_paper_position`: caller must provide `idempotencyKey`. Approval
  scope includes exact chart identity, side, quantity, SL, TP, and key. Tool is
  visual paper simulation only; it cannot place real orders.

First call returns `APPROVAL_REQUIRED` plus short-lived token and performs zero
chart writes. Tokens are process-local, scope-bound, single-use, and rejected
after expiry, wrong-scope use, or replay. Agent/client remains responsible for
waiting for actual user approval. Host `actionPolicy` still runs independently;
MCP approval never overrides host denial.

Completed paper same-key/same-payload retries return stored receipt without new
chart action. Same key with changed payload returns `IDEMPOTENCY_CONFLICT`.
Ambiguous bridge failure marks key indeterminate and denies automatic retry;
inspect chart state, reconcile outcome, then use new key with fresh approval.
Journal is process-local, not durable: restart/crash cannot promise exactly-once.

## Configuration

All configuration is via environment variables. Set them in your MCP client's server config (an `env` block) or in your shell before launching the server.

| Variable | Default | What it does |
| --- | --- | --- |
| `ROMACO_MCP_PORT` | `7399` | WebSocket port the live-chart bridge connects on. Must match the `port` prop on `<McpBridge />`. |
| `ROMACO_MCP_BRIDGE_AUTH` | `auto` | `auto` selects paired v2 with a valid token; `required` fails closed; `legacy` enables v1. |
| `ROMACO_MCP_BRIDGE_TOKEN` | _(empty)_ | Pairing secret: exactly 32 random bytes encoded as canonical base64url. |
| `ROMACO_MCP_ALLOWED_ORIGINS` | _(localhost + `https://romaco.io`)_ | Extra comma-separated exact HTTP(S) origins. No wildcards. |
| `ROMACO_CACHE_DIR` | `~/.romaco/cache` | On-disk cache directory for yfinance data, with a per-timeframe TTL. |
| `ROMACO_APP_URL` | _(empty)_ | Optional. A chart-app URL the server can auto-open when no bridge is connected. |
| `ROMACO_TOKEN` | _(empty)_ | Reserved. It does not authorize or trigger candle egress today. |
| `ROMACO_API_URL` | _(unused)_ | Reserved for a future explicitly authorized remote adapter. |
| `ROMACO_MCP_TELEMETRY` | _(off)_ | `jsonl` enables redacted local telemetry on stderr only. |

To set them, add an `env` block to your server config:

```json
{
  "mcpServers": {
    "romaco": {
      "command": "npx",
      "args": ["-y", "@romaco/mcp"],
      "env": {
        "ROMACO_MCP_PORT": "7399",
        "ROMACO_CACHE_DIR": "~/.romaco/cache"
      }
    }
  }
}
```

You can also pass the port as a flag: `npx -y @romaco/mcp --port 3200`.

### Pair the live chart

Generate one secret and provide same value to both endpoints:

```bash
node -e "console.log(require('node:crypto').randomBytes(32).toString('base64url'))"
```

MCP client config:

```json
{
  "mcpServers": {
    "romaco": {
      "command": "npx",
      "args": ["-y", "@romaco/mcp"],
      "env": {
        "ROMACO_MCP_BRIDGE_AUTH": "required",
        "ROMACO_MCP_BRIDGE_TOKEN": "<generated-token>"
      }
    }
  }
}
```

Inject value into `<McpBridge security={{ mode: 'paired', token }} />` at
runtime. Never commit it or put it in public JS bundle, URL, logs, or browser
storage. Use in-memory input for current page lifetime.

`auto` without token preserves legacy compatibility and logs warning.
`required` without valid token disables chart bridge; headless tools stay
available. Paired mode never falls back to legacy after failed handshake.
Legacy compatibility is unauthenticated and is not secure by default; use
`required` plus paired `McpBridge` in production. Browser-to-server frames are
capped at 8 MiB, safely above typical chart snapshot responses.

## Local analysis and remote egress

All current analysis runs locally. Setting `ROMACO_TOKEN` or `ROMACO_API_URL`
does not transmit candles and does not enable a Pro delegation path. A future
remote adapter requires an explicit authorization contract and updated egress
documentation before use.

Live atomic annotations require a compatible chart host. See
[Chart bridge compatibility](./CHART_BRIDGE_COMPATIBILITY.md).
