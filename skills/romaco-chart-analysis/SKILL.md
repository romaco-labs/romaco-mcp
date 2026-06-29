---
name: romaco-chart-analysis
description: >-
  Scaffold a live romaco-charts chart, wire it to the romaco MCP bridge, run an
  institutional technical analysis, and annotate the chart in place. Use when the
  user wants to analyze a ticker (SPY, AAPL, BTC-USD, …) on a real chart, draw
  indicators/levels/a thesis on it, or stand up a romaco-charts app driven by an
  AI agent. Requires the `romaco` MCP server connected.
---

# Romaco chart analysis

Build a real `romaco-charts` chart, connect it to the romaco MCP bridge, analyze a
ticker with the MCP's deterministic tools, and draw the result on the live chart.

## Critical gotchas — these break cold runs, do not skip

1. **Fetch market data SERVER-SIDE only.** A browser `fetch` to Yahoo fails with
   CORS, and a hand-rolled proxy gets `429`. Use the **`yahoo-finance2`** library
   (v3) inside a Vite dev-server middleware — it handles Yahoo's cookie/crumb
   handshake and retries (it is the same library the MCP uses internally).
2. **No `<StrictMode>`.** Its dev-only double mount/unmount tears down the
   `McpBridge` WebSocket ("WebSocket is closed before the connection is
   established"). Render the app without it.
3. **Apply each indicator exactly once.** Call `romaco_setup_chart` with
   `preset: "clean"` (no indicators), then add indicators once during annotation.
   A preset that pre-loads indicators **plus** a manual add = duplicated rows in
   the legend (double EMA/RSI, a flood of VOL).
4. **One MCP owns port 7399.** The browser bridge connects to whichever MCP holds
   `7399`. If two agents (e.g. Claude and Codex) both run the romaco MCP, they
   fight for the port. Run only one.

## Workflow

### 1. Scaffold the chart app
- Vite + React + TypeScript project (wherever the user asks).
- Install: `romaco-charts`, `react`, `react-dom`, `yahoo-finance2@^3`.
- **`vite.config.ts`** — a plugin exposing `GET /api/<symbol>-daily`, server-side:
  ```ts
  import YahooFinance from 'yahoo-finance2'
  const yf = new YahooFinance()
  // period1 ≈ 1–3y back, enough for EMA200 / volume profile / structure
  const result = await yf.chart(SYMBOL, { period1, interval: '1d' })
  // map each quote → { time, open, high, low, close, volume }
  //   time = Math.floor(new Date(q.date).getTime() / 1000)  // UNIX seconds
  //   skip rows with null OHLC; cache in memory; respond { candles }
  ```
- **`src/App.tsx`** — fetch the candles from the proxy (same-origin, no CORS),
  pass `data={candles}` to `<TradingTerminal ref={ref} symbol={SYMBOL} data={candles} />`,
  and mount `<McpBridge chartRef={ref} />` below it.
- **`src/main.tsx`** — render WITHOUT `<StrictMode>`.
- `npm install` → `npm run dev` → open the dev URL in the browser.

### 2. Confirm the bridge
- Call `romaco_list_panes`. If it returns the chart's panes, the bridge is live.
  If not, make sure the dev server is running and the browser tab is open, then retry.

### 3. Analyze (headless, via the MCP)
- `romaco_setup_chart` `{ symbol, preset: "clean", timeframe: "1d" }`
- `romaco_analyze_market` — trend, price action, momentum (RSI/MACD/divergences), volatility (ATR/Bollinger)
- `romaco_find_levels` — support/resistance + Volume Profile (POC/VAH/VAL)
- `romaco_detect_patterns` — H&S, double tops/bottoms, triangles, flags
- `romaco_thesis` — verdict (long/short/stand_aside) + confidence + setup + invalidation

### 4. Annotate the live chart
- `romaco_add_indicator` **once each**: EMA 20, EMA 50, EMA 200, RSI 14, VOL.
  Then `romaco_list_panes` and confirm each appears exactly once.
- `romaco_add_drawing` for the key levels (support/resistance, POC).
- State the verdict, then **offer** to draw the thesis. Only on approval call
  `romaco_annotate` (it draws entry/stop/target with visual hierarchy and honors
  stand_aside — no invented setup).
- `romaco_capture_snapshot` to capture the annotated chart.

### 5. Verify before reporting done
- The chart renders candles (price bars, not an empty pane).
- `romaco_list_panes` shows each indicator exactly once — if any is duplicated,
  remove the extras with `romaco_remove_indicator` until each is unique.
- No errors in the browser console.

## Rules
- **Never compute or invent prices** — always query the MCP tools and reason over
  the features they return.
- **Never dump raw OHLCV** — it is gated behind `acknowledgeHighTokenCost: true`
  and only when the user explicitly asks.
- **Never annotate the thesis without the user's approval first.**
- Always end any thesis output with:
  `⚠️ Not investment advice — educational purposes only.`
