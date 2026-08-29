# @romaco/mcp

MCP server for [romaco-charts](https://www.npmjs.com/package/romaco-charts). Control your trading chart from Claude, Cursor, or any MCP-compatible AI agent.

```bash
npx @romaco/mcp
```

![romaco-mcp — an AI agent draws technical analysis on a live chart, grounded in deterministic math (not a hallucinated number in sight)](docs/demo.gif)

---

## Philosophy

Romaco MCP is **compression-first**. Tools return features and decisions, not raw OHLCV. Most default tool payloads stay under **2 KB**; `romaco_analyze_market` is the deliberate exception at **2.4–4.1 KB** across the eight recorded 400-bar fixtures. Large payloads such as snapshots, visible-candle arrays, and all-bar indicator series are **gated** behind `acknowledgeHighTokenCost: true`. Full raw chart-state export is disabled until an explicitly authorized host contract exists.

The rule: *the agent never computes, it always queries*. An agent reasoning over computed features can't invent the numbers underneath its analysis — it reads the RSI, the levels, the last price from code, not from its imagination. It still *interprets* them, so the thesis can still be wrong: grounding the data is not the same as grounding the conclusion. But an agent given a 70 KB raw OHLCV dump will burn its context window before it can finish a thought — and invent half the numbers on the way.

### Cost table

| Tool | Default | Gated raw (with `acknowledgeHighTokenCost:true`) |
|---|---|---|
| `romaco_analyze_market` | 2.4–4.1 KB on recorded 400-bar fixtures | — |
| `romaco_thesis` | <2 KB computed bull/bear debate + verdict + setup | — |
| `romaco_find_levels` | <500 B | — |
| `romaco_detect_patterns` | <2 KB (trimmed hits) | full hits with anchor `points[]` |
| `romaco_setup_chart` | <5 KB (setup log + summary) | — |
| `romaco_load_candles` | <200 B ack | — |
| `romaco_calculate_position_size` | <1 KB | — |
| `romaco_list_templates` | ~4.5 KB static catalog | — |
| `romaco_list_panes` | <1 KB | — |
| `romaco_get_chart_context` | ~1 KB snapshot | disabled; returns `ACTION_DENIED` |
| `romaco_get_visible_candles` | <1 KB range summary | ~70 KB raw OHLCV |
| `romaco_get_indicator_values` | <500 B last/prev/delta/state | ~10 KB per-bar series |
| `romaco_capture_snapshot` | error (must ack) | 300–800 KB base64 image |
| `romaco_add_*`, `romaco_set_*`, `romaco_clear_*`, `romaco_go_to_*`, `romaco_open_paper_position` | <100 B ack messages | — |

## 30-second start

```bash
# 1. Install
npm install -g @romaco/mcp

# 2. Wire it into Claude Code (run from your project root)
cat > .mcp.json <<'EOF'
{ "mcpServers": { "romaco": { "command": "romaco-mcp" } } }
EOF
```

Then start Claude Code and prompt:

> Use `romaco_setup_chart` to analyze AAPL daily with the `trend_analysis` preset.

That's it. The MCP server fetches yfinance data (with disk cache + cookie/crumb handshake), runs full technical analysis, and returns a compressed MarketSummary. No API key required; the cache reduces repeated upstream requests, but Yahoo can still rate-limit traffic and the server reports that failure explicitly.

### Live chart control (optional)

To let Claude drive a real chart — drawings, indicators, alerts visible in your browser — mount `<McpBridge />` next to your `TradingTerminal`:

```tsx
import { TradingTerminal, McpBridge, type TradingTerminalRef } from 'romaco-charts/react';
import { useRef } from 'react';

function App() {
  const ref = useRef<TradingTerminalRef | null>(null);
  const bridgeToken = getBridgeTokenFromRuntime();
  return (
    <>
      <TradingTerminal ref={ref} data={candles} symbol="AAPL" />
      <McpBridge chartRef={ref} security={{ mode: 'paired', token: bridgeToken }} />
    </>
  );
}
```

See [examples/pro-volatility-scanner](./examples/pro-volatility-scanner) for a complete setup. With `<McpBridge />` mounted, the chart-bridge tools (`add_indicator`, `add_drawing`, `add_alert`, `capture_snapshot`, …) become available. Atomic thesis/pattern annotation additionally requires the host action documented in [Chart bridge compatibility](./docs/CHART_BRIDGE_COMPATIBILITY.md); older hosts fail closed instead of falling back to sequential drawing writes.

### Data cache

Every successful `yfinance` fetch is cached to `~/.romaco/cache/` with per-timeframe TTL (1m→1min, 1h→1h, 1d→24h, …). A grid of N widgets requesting the same symbol triggers **one** upstream fetch. Wipe the cache anytime with `rm -rf ~/.romaco/cache`, or override the location with `ROMACO_CACHE_DIR=/tmp/cache`.

## What it does

Exposes 20+ MCP tools in two categories:

**Headless tools** — work without a browser, load data and run analysis server-side:
- `romaco_setup_chart` — one-command setup: load + preset + analyze (recommended first call)
- `romaco_load_candles` — fetch OHLCV from Yahoo Finance (free) or pass your own array
- `romaco_analyze_market` — full technical analysis: trend, S/R levels, RSI/MACD/divergences, volatility, patterns
- `romaco_thesis` — computed bull/bear debate → verdict (long/short/stand_aside) + confidence + entry/stop/target setup; stands aside when R/R is poor (won't fake a signal)
- `romaco_find_levels` — support/resistance via K-means + Volume Profile (POC/VAH/VAL)
- `romaco_detect_patterns` — H&S, double top/bottom, triangles, flags
- `romaco_calculate_position_size` — pure-math risk-based position sizing with R/R + breakeven win-rate
- `romaco_list_templates` — catalog of drawing templates (trendline, fib, channels, …)

**Chart-bridge tools** — control a live Romaco chart in the browser:
- `romaco_add_indicator` — EMA, RSI, MACD, Bollinger, ATR, 29+ indicators
- `romaco_add_drawing` — trendlines, Fibonacci, horizontal lines, channels, rectangles
- `romaco_add_alert` — price alerts with direction (above/below/cross)
- `romaco_capture_snapshot` — PNG/JPEG base64 for vision LLMs
- `romaco_open_paper_position` — simulated long/short with SL/TP
- `romaco_get_chart_context` — complete chart state as JSON
- `romaco_get_visible_candles` — OHLCV in current viewport
- `romaco_set_zoom` / `romaco_reset_view` — zoom control
- `romaco_clear_drawings` — remove all drawings
- `romaco_list_panes` — enumerate main + subpanel panes (e.g. RSI subpanel id)
- `romaco_get_indicator_values` — read computed indicator series (by id or name)
- `romaco_go_to_timestamp` — scrub viewport to a given timestamp

---

## Install

### Claude Desktop

Add to `~/Library/Application Support/Claude/claude_desktop_config.json`:

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

Restart Claude Desktop.

### Claude Code

```bash
claude mcp add romaco -- npx -y @romaco/mcp
```

Or add to your project's `.mcp.json`:

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

### Cursor / other MCP clients

Any client that supports stdio MCP servers works. Point it at `npx @romaco/mcp`.

---

## Usage

### Headless analysis (no browser needed)

```
Load 500 candles of AAPL 1h from yfinance, then analyze the market.
```

Claude will call:
1. `romaco_load_candles` → fetches from Yahoo Finance
2. `romaco_analyze_market` → returns a compressed MarketSummary (2.4–4.1 KB on the recorded 400-bar fixture suite)
3. `romaco_find_levels` → S/R zones, POC, VAH, VAL
4. Reasons over the features → tells you what it sees

### Live chart control (with browser)

Add `<McpBridge />` to your chart app:

```tsx
import { TradingTerminal, McpBridge } from 'romaco-charts/react';

function App() {
  const ref = useRef(null);
  const bridgeToken = getBridgeTokenFromRuntime();
  return (
    <>
      <TradingTerminal ref={ref} symbol="AAPL" timeframe="1h" datafeed={myDatafeed} />
      <McpBridge chartRef={ref} security={{ mode: 'paired', token: bridgeToken }} />
    </>
  );
}
```

Then from Claude:
```
Add EMA 20 and RSI 14 to the chart, draw a Fibonacci from the last swing low to swing high,
and capture a snapshot so I can see it.
```

---

## Data sources

| Source | Auth | Coverage |
|--------|------|----------|
| `yfinance` | None (default) | Stocks, ETFs, crypto, FX, indices — delayed data |
| `raw` | None | Pass your own OHLCV array inline |

**Bring your own key (BYOK)** — Coming in v1.1: Alpaca, Polygon.io, FMP.

---

## Configuration

| Option | Default | How to set |
|--------|---------|-----------|
| WebSocket port | `7399` | `--port 3200` or `ROMACO_MCP_PORT=3200` |
| `ROMACO_MCP_BRIDGE_AUTH` | `auto` | `auto`, `required`, or explicit `legacy` compatibility mode |
| `ROMACO_MCP_BRIDGE_TOKEN` | _(none)_ | Canonical base64url encoding of exactly 32 random bytes |
| `ROMACO_TOKEN` | _(empty)_ | Reserved. Does not authorize or trigger candle egress today. |
| `ROMACO_API_URL` | _(unused)_ | Reserved for a future explicitly authorized remote-adapter contract. |
| `ROMACO_MCP_ALLOWED_ORIGINS` | _(localhost + `https://romaco.io`)_ | Comma-separated exact HTTP(S) origins for `<McpBridge />` pages on other domains |
| `ROMACO_MCP_TELEMETRY` | _(off)_ | Set exactly `jsonl` for redacted local tool telemetry on stderr. Never sends telemetry over network. |

**Bridge security**: paired v2 mutually authenticates server and browser with
HMAC-SHA-256 before chart traffic. Token never crosses WebSocket. Generate one
once, configure MCP process, inject same value into `<McpBridge />` at runtime:

```bash
node -e "console.log(require('node:crypto').randomBytes(32).toString('base64url'))"

ROMACO_MCP_BRIDGE_AUTH=required \
ROMACO_MCP_BRIDGE_TOKEN="<generated-token>" \
ROMACO_MCP_ALLOWED_ORIGINS="https://myapp.com" \
npx @romaco/mcp
```

Never put token in source, public bundle, URL, logs, or browser storage. Use
in-memory input for current page lifetime. `auto` selects paired v2 with valid
token; no token keeps legacy v1 with warning. Malformed configured token
disables only chart bridge. `required` never falls back to v1.

Listener binds `127.0.0.1`; exact origins add defense in depth. Localhost pages
still need pairing token. Frames are not encrypted. Never expose listener
remotely; use authenticated TLS gateway for non-loopback deployments.

```bash
# Custom port
npx @romaco/mcp --port 3200

# Or via env
ROMACO_MCP_PORT=3200 npx @romaco/mcp
```

Set the same port in `<McpBridge port={3200} />`.

---

## Local execution and remote egress

Current tools compute analysis locally in `src/compression`. Setting
`ROMACO_TOKEN` or `ROMACO_API_URL` does **not** authorize transmission of candles
to a remote analysis service. When a token is present, `romaco_thesis` returns a
structured `REMOTE_EGRESS_DISABLED` warning and uses the local artifact unless an
already validated gateway artifact was injected through an authorized host path.

A future remote adapter must add explicit authorization, validated boundary
schemas, transport security, trace propagation, and user-facing egress docs
before it can become callable. No automatic network fallback exists today.

---

## Example prompts

**Institutional analysis:**
> "Load TSLA 4h from yfinance, analyze the market, find key levels, detect any chart patterns, then draw the Fibonacci retracement of the last swing on the chart and add an alert at the 0.618 level."

**Conditional automation:**
> "Load AAPL 15m, run full analysis. If RSI shows bullish divergence and price is near a support level, open a paper long 100 shares with stop loss at the VAL of the Volume Profile."

**Pattern scanner:**
> "Load SPY 1d and detect patterns. For any head & shoulders found, tell me the target price and invalidation level."

---

## Requirements

- Node.js >= 20
- For chart-bridge tools: romaco-charts >= 1.0.0-beta.6 with `<McpBridge />` in your app

---

## Links

- [romaco-charts npm](https://www.npmjs.com/package/romaco-charts)
- [Documentation](./docs/INSTALL.md)
- [romaco.io](https://www.romaco.io)
- [GitHub](https://github.com/romaco-labs/romaco-mcp)
