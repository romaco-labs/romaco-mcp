# @romaco/mcp — Installation & Configuration

## What it is

`@romaco/mcp` is an MCP (Model Context Protocol) server that lets Claude, Cursor, or any MCP-compatible AI agent run market analysis and control a trading chart through plain-language prompts.

## Prerequisites

- **Node.js >= 18** (the server is published as ESM and run with `npx`)
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

  return (
    <>
      <TradingTerminal ref={chartRef} symbol="AAPL" />
      <McpBridge chartRef={chartRef} />
    </>
  );
}
```

With the bridge connected, the chart-bridge tools become live. If the bridge is not mounted, those tools simply have nothing to talk to — the headless tools keep working regardless.

## Configuration

All configuration is via environment variables. Set them in your MCP client's server config (an `env` block) or in your shell before launching the server.

| Variable | Default | What it does |
| --- | --- | --- |
| `ROMACO_MCP_PORT` | `7399` | WebSocket port the live-chart bridge connects on. Must match the `port` prop on `<McpBridge />`. |
| `ROMACO_CACHE_DIR` | `~/.romaco/cache` | On-disk cache directory for yfinance data, with a per-timeframe TTL. |
| `ROMACO_APP_URL` | _(empty)_ | Optional. A chart-app URL the server can auto-open when no bridge is connected. |
| `ROMACO_TOKEN` | _(empty)_ | Empty = Free. Set it to enable Pro (delegates heavy compute to the backend). |
| `ROMACO_API_URL` | `http://localhost:8000` | Pro backend endpoint (dev default). Set to `https://api.romaco.tech` for the hosted backend. |

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

## Free vs Pro

**Free** runs fully standalone: all analysis is computed locally on your machine, with no account and no token required. **Pro** is enabled by setting `ROMACO_TOKEN`, which delegates heavy compute to the backend for faster, richer results. If the token is missing or the backend is unreachable, the server automatically falls back to local compute — so the free path never breaks.
