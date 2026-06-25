import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { loadCandles } from '../data/loader.js';
import { analyzeSession } from '../compression/analyze.js';
import { session } from '../session.js';
import type { LoadResponse, Timeframe } from '../data/types.js';
import type { TradeThesis } from '../compression/thesis.js';

const TIMEFRAMES = [
  '1m', '2m', '5m', '15m', '30m',
  '1h', '2h', '4h',
  '1d', '5d', '1w', '1mo', '3mo',
] as const;

interface SymbolResult {
  symbol: string;
  load: LoadResponse;
  thesis: TradeThesis;
  score: number;
}

function confBar(filled: number, total = 10): string {
  const n = Math.round(Math.max(0, Math.min(1, filled)) * total);
  return '█'.repeat(n) + '░'.repeat(total - n);
}

export function registerThesisBatch(server: McpServer): void {
  server.registerTool(
    'romaco_thesis_batch',
    {
      description:
        'Analyze multiple tickers in one call, compare their trade setups, and return a ranked table ' +
        'sorted by R/R × confidence (best setup first). ' +
        'Fetches OHLCV data for each symbol via yfinance (free), runs a deterministic bull/bear thesis ' +
        '(no LLM, no hallucination) for each, then ranks them. ' +
        'After returning the table, OFFER to draw the top-ranked setup on the user\'s chart: ' +
        '"Draw the [SYMBOL] setup on your chart? (Recommended)" — ' +
        'if the user accepts, call romaco_setup_chart then romaco_annotate. ' +
        'The top-ranked symbol is automatically loaded into session so romaco_annotate runs immediately. ' +
        'Always end your response with: "⚠️ Not investment advice — educational purposes only."',
      inputSchema: {
        symbols: z
          .array(z.string().min(1))
          .min(1)
          .max(10)
          .describe('Tickers to analyze, e.g. ["AAPL", "NVDA", "MSFT"]. Max 10.'),
        timeframe: z
          .enum(TIMEFRAMES)
          .optional()
          .describe('Candle timeframe. Default "1d".'),
        lookback: z
          .number()
          .min(50)
          .max(2000)
          .optional()
          .describe('Number of candles per symbol (default 300).'),
      },
    },
    async ({ symbols, timeframe = '1d', lookback = 300 }) => {
      const results: SymbolResult[] = [];
      const errors: string[] = [];

      // Serial: avoids yfinance rate-limit when analyzing N symbols.
      for (const symbol of symbols) {
        try {
          const load = await loadCandles({
            source: 'yfinance',
            symbol,
            timeframe: timeframe as Timeframe,
            lookback,
          });
          const { thesis } = analyzeSession(load.candles);
          const score = thesis.setup ? thesis.setup.rr * thesis.confidence : 0;
          results.push({ symbol, load, thesis, score });
        } catch (err) {
          errors.push(`${symbol}: ${err instanceof Error ? err.message : String(err)}`);
        }
      }

      if (results.length === 0) {
        return {
          content: [{
            type: 'text' as const,
            text: `All symbols failed to load:\n${errors.join('\n')}`,
          }],
          isError: true,
        };
      }

      // Rank: best R/R × confidence first; stand_aside symbols sink to bottom.
      results.sort((a, b) => b.score - a.score);
      const top = results[0];

      // Store top pick in session — romaco_annotate can run immediately after user confirms.
      session.setLastLoad(top.load);

      const lines: string[] = [];

      // ─── Ranked table ───────────────────────────────────────────────────────
      lines.push('SYMBOL  VERDICT   R/R    CONF  CONFIDENCE    ENTRY      STOP       TARGET');
      lines.push('──────  ────────  ─────  ────  ──────────    ─────────  ─────────  ─────────');

      for (const r of results) {
        const { symbol, thesis: t } = r;
        const verdictLabel = t.verdict === 'stand_aside'
          ? 'STAND   '
          : t.verdict === 'long'
          ? 'LONG    '
          : 'SHORT   ';
        const rr = t.setup ? t.setup.rr.toFixed(1).padStart(5) : '  —  ';
        const conf = t.confidence.toFixed(2);
        const bar = confBar(t.confidence);
        const entry  = t.setup ? `$${t.setup.entry.toFixed(2)}`.padStart(9) : '    —    ';
        const stop   = t.setup ? `$${t.setup.stop.toFixed(2)}`.padStart(9)  : '    —    ';
        const target = t.setup ? `$${t.setup.target.toFixed(2)}`.padStart(9) : '    —    ';
        lines.push(
          `${symbol.padEnd(6)}  ${verdictLabel}  ${rr}  ${conf}  ${bar}    ${entry}  ${stop}  ${target}`
        );
      }

      lines.push('');

      // ─── Top pick summary ───────────────────────────────────────────────────
      const marker = top.thesis.verdict === 'stand_aside' ? '⚠' : '▲';
      lines.push(`${marker} Top pick: ${top.symbol} — ${top.thesis.verdict.toUpperCase()}`);

      if (top.thesis.setup) {
        const s = top.thesis.setup;
        lines.push(`  R/R ${s.rr.toFixed(1)} · confidence ${(top.thesis.confidence * 100).toFixed(0)}%`);
        lines.push(`  Entry $${s.entry.toFixed(2)} · Stop $${s.stop.toFixed(2)} · Target $${s.target.toFixed(2)}`);
        lines.push(`  Basis: ${s.basis}`);
      } else {
        lines.push(`  No clean setup found — confidence too low or R/R < 1.`);
      }

      lines.push(`  Session loaded with ${top.symbol} candles — romaco_annotate is ready.`);

      if (errors.length > 0) {
        lines.push(`\n⚠ Could not load: ${errors.join('; ')}`);
      }

      lines.push('\n⚠️ Not investment advice — educational purposes only.');

      return { content: [{ type: 'text' as const, text: lines.join('\n') }] };
    }
  );
}
