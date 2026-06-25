# pro-volatility-scanner

A real-time volatility dashboard built on `romaco-charts`, wired live to
the `@romaco/mcp` **Pattern Engine v2** (30 geometric patterns — harmonic XABCD,
ATR-filtered double tops/bottoms, momentum gaps, rounding bottoms, channels,
wedges, cup & handle).

The watchlist is the wildest tape on the market — MSTR, TSLA, COIN, SMCI, MARA —
the regime where ATR-filtered detection earns its keep. Left-rail metrics
(ATR(14), ATR %, 20d annualized realized vol) are computed **client-side from the
same candles on screen** — the exact bars the analyst computes its thesis on.

## Operating-room treatment

When the MCP bridge reports `onProcessingChange(true)` — i.e. the agent is
injecting drawing layers — the chart goes "under the knife":

- candles blur + dim,
- a pulsing volatility-orange glow frame,
- a sweeping scanline,
- a `PATTERN ENGINE v2 — INJECTING LAYERS` chip.

It all fades back out when the burst settles (≥900ms showtime, 450ms quiet
window) so the finished scan is **revealed, not popped**.

## Run

```bash
# Install + run the scanner (pulls romaco-charts + @romaco/mcp from npm)
npm install
npm run dev          # http://localhost:5174
```

The MCP server (`.mcp.json`) auto-opens the app at `:5174` and connects the
bridge on port **7399**. Then drive it from your MCP client:

```
romaco_thesis_batch  symbols=["MSTR","TSLA"]  timeframe=1d
romaco_setup_chart   symbol=MSTR  timeframe=1d
romaco_draw_pattern  kind=...     # one per family: harmonic / gap / reversal
```

> ⚠ Not investment advice — educational purposes only.
