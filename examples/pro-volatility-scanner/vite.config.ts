import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';
import YahooFinance from 'yahoo-finance2';

// This scanner consumes `romaco-charts` as a package (via the file:../..
// dependency) — exactly like a user who ran `npm i romaco-charts`. There is NO
// source alias, so run `npm run build` at the repo root once so dist/ exists.
const root = path.resolve(__dirname, '../..');

// Yahoo requires a cookie/crumb handshake — raw fetches get 429'd at the edge.
// yahoo-finance2 (the same library @romaco/mcp uses) handles it, so the chart
// shows the SAME candles the analyst computes its thesis on.
const yf = new YahooFinance({ validation: { logErrors: false } });

function yahooCandles(): Plugin {
  return {
    name: 'yahoo-candles',
    configureServer(server) {
      server.middlewares.use('/api/candles', async (req, res) => {
        try {
          const url = new URL(req.url ?? '', 'http://localhost');
          const symbol = (url.searchParams.get('symbol') ?? 'MSTR').toUpperCase();
          const lookback = Number(url.searchParams.get('lookback') ?? 400);

          // 1.5x margin so weekend/holiday gaps still yield `lookback` bars.
          const period1 = new Date(Date.now() - lookback * 86_400_000 * 1.5);
          const result = await yf.chart(symbol, { period1, interval: '1d' });

          const candles = (result.quotes ?? [])
            .filter((q) => q.open != null && q.high != null && q.low != null && q.close != null)
            .map((q) => {
              const time = new Date(q.date).getTime();
              return {
                time,
                timestamp: time,
                open: q.open,
                high: q.high,
                low: q.low,
                close: q.close,
                volume: q.volume ?? 0,
              };
            })
            .slice(-lookback);

          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify(candles));
        } catch (err) {
          res.statusCode = 502;
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify({ error: err instanceof Error ? err.message : String(err) }));
        }
      });
    },
  };
}

export default defineConfig({
  plugins: [react(), yahooCandles()],
  resolve: {
    // The single React copy must be shared with the library, or hooks break.
    dedupe: ['react', 'react-dom'],
  },
  server: {
    // Distinct port from ai-analyst-demo (5173) so both can run side-by-side.
    port: 5174,
    // The symlinked package lives in the parent monorepo tree (dist/, dist/wasm/).
    fs: { allow: [root] },
  },
});
