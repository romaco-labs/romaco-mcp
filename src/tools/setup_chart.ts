import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { loadCandles } from '../data/loader.js';
import { composeMarketSummary } from '../compression/summary.js';
import { trimPatternHits } from '../compression/snapshot.js';
import { session } from '../session.js';
import { bridge } from '../bridge.js';
import { chartState } from '../chartState.js';
import { PRESETS, PRESET_NAMES } from '../presets/index.js';
import type { Timeframe, DataSourceName } from '../data/types.js';

const TIMEFRAMES = [
  '1m', '2m', '5m', '15m', '30m',
  '1h', '2h', '4h',
  '1d', '5d', '1w', '1mo', '3mo',
] as const;

export function registerSetupChart(server: McpServer): void {
  server.registerTool(
    'romaco_setup_chart',
    {
      description:
        'One-command chart setup: loads OHLCV data, runs full market analysis, and (if browser is connected) applies a professional indicator preset to the chart. ' +
        `Available presets: ${PRESET_NAMES.join(', ')}. ` +
        'Works headless too — returns MarketSummary even without a connected browser. ' +
        'This is the recommended first tool to call for any analysis session.',
      inputSchema: {
        symbol: z.string().describe('Ticker symbol: "AAPL", "TSLA", "BTC-USD", "EURUSD=X"'),
        preset: z.enum(PRESET_NAMES as [string, ...string[]]).optional().describe(
          `Chart preset. Options: ${PRESET_NAMES.map(n => `"${n}"`).join(', ')}. Omit for "institutional".`
        ),
        timeframe: z.enum(TIMEFRAMES).optional().describe(
          'Override the preset\'s default timeframe. Omit to use the preset default.'
        ),
        source: z.enum(['yfinance', 'raw']).optional().describe(
          '"yfinance" (default, free) or "raw" (provide your own candles via rawCandles).'
        ),
        lookback: z.number().min(50).max(2000).optional().describe(
          'Number of candles to load (default from preset, max 2000).'
        ),
        rawCandles: z
          .array(z.object({
            timestamp: z.number(),
            open: z.number(),
            high: z.number(),
            low: z.number(),
            close: z.number(),
            volume: z.number(),
          }))
          .optional()
          .describe('Required when source="raw". Array of {timestamp, open, high, low, close, volume}.'),
      },
    },
    async ({ symbol, preset: presetName, timeframe, source, lookback, rawCandles }) => {
      const preset = PRESETS[presetName ?? 'institutional'];
      const tf = (timeframe ?? preset.defaultTimeframe) as Timeframe;
      const bars = lookback ?? preset.lookback;
      const src = (source ?? 'yfinance') as DataSourceName;

      const lines: string[] = [];

      // 1. Load candles
      try {
        const loaded = await loadCandles({ source: src, symbol, timeframe: tf, lookback: bars, rawCandles });
        session.setLastLoad(loaded);

        const first = loaded.candles[0];
        const last = loaded.candles[loaded.candles.length - 1];
        lines.push(`✓ Loaded ${loaded.candles.length} candles — ${symbol} ${tf} via ${src}`);
        lines.push(`  Range: ${new Date(first.timestamp * 1000).toISOString().slice(0, 10)} → ${new Date(last.timestamp * 1000).toISOString().slice(0, 10)}`);
        lines.push(`  Last close: ${last.close.toFixed(2)}`);
      } catch (err) {
        return {
          content: [{ type: 'text' as const, text: `Failed to load data: ${err instanceof Error ? err.message : String(err)}` }],
          isError: true,
        };
      }

      // 2. Apply preset indicators to chart (if browser connected)
      if (bridge.isConnected && preset.indicators.length > 0) {
        lines.push(`\n✓ Applying preset "${preset.name}" to chart:`);
        for (const ind of preset.indicators) {
          try {
            await bridge.executeAction({ action: 'addIndicator', indicatorType: ind.type, params: ind.params });
            // Journal it so the preset survives a chart re-create (reconcile-on-ready).
            chartState.recordIndicator(
              { action: 'addIndicator', indicatorType: ind.type, params: ind.params },
              symbol,
            );
            const label = ind.params ? `${ind.type}(${ind.params.join(', ')})` : ind.type;
            lines.push(`  + ${label}`);
          } catch {
            lines.push(`  ✗ ${ind.type} — failed (non-critical)`);
          }
        }
      } else if (preset.indicators.length > 0) {
        lines.push(`\n⚠ No browser connected — indicators not applied to chart.`);
        lines.push(`  Add <McpBridge chartRef={ref} /> to your app to enable chart control.`);
        lines.push(`  Preset indicators would be: ${preset.indicators.map(i => i.type + (i.params ? `(${i.params.join(',')})` : '')).join(', ')}`);
      }

      // 3. Run market analysis. Three compression passes keep the response
      // under ~2 KB for any normal symbol:
      //   - patterns: trimmed to anchor_count + sliced to top 5 by confidence
      //   - plr: only the last 4 segments (recent piecewise structure is what
      //     a trader actually reasons over; deep history is noise here)
      //   - JSON serialized compact (no pretty-print whitespace)
      // Callers who need the full set should use the dedicated tools with
      // acknowledgeHighTokenCost:true.
      lines.push('\n─── Market Analysis ───');
      try {
        const candles = session.requireCandles();
        // Pro delegation (server-side summary) is planned; today this computes locally.
        const summary = composeMarketSummary(candles);
        const compactSummary = {
          ...summary,
          plr: summary.plr.slice(-4),
          patterns: trimPatternHits(summary.patterns)
            .sort((a, b) => b.confidence - a.confidence)
            .slice(0, 5),
        };
        lines.push(JSON.stringify(compactSummary));
      } catch (err) {
        lines.push(`Analysis failed: ${err instanceof Error ? err.message : String(err)}`);
      }

      // Auto-open browser when ROMACO_APP_URL is set and no bridge is connected yet.
      // Gives the user the chart tab without leaving the terminal.
      const appUrl = process.env.ROMACO_APP_URL;
      if (appUrl && !bridge.isConnected) {
        const { execFile } = await import('child_process');
        const opener =
          process.platform === 'darwin' ? 'open'
          : process.platform === 'win32' ? 'explorer'
          : 'xdg-open';
        execFile(opener, [appUrl], () => { /* best-effort: ignore missing opener */ });
        lines.push(`\n🌐 Opening ${appUrl} — add <McpBridge /> then call romaco_annotate to draw.`);
      }

      return { content: [{ type: 'text' as const, text: lines.join('\n') }] };
    }
  );
}
