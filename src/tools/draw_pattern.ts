import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { bridge } from '../bridge.js';
import { session } from '../session.js';
import { chartState } from '../chartState.js';
import { enrichBridgeResult } from './_guards.js';
import { selectRecentPatterns } from '../compression/patterns.js';
import { cachedDetectPatterns } from '../compression/scanCache.js';
import { PATTERN_KINDS } from '../compression/types.js';
import { mapPatternToDrawings, patternGroupId } from './_patternDrawings.js';

const DESC =
  'Draw the GEOMETRY of a detected chart pattern on the user\'s browser chart: head & shoulders ' +
  'neckline + silhouette, double top/bottom extremes + trigger line, triangle border trendlines, ' +
  'flag polyline — plus faint dotted target/invalidation levels when the pattern projects them. ' +
  'Patterns are re-detected from the loaded candles (deterministic math, never agent-supplied ' +
  'geometry) and only RECENT patterns qualify — if none match, nothing is drawn and that is the ' +
  'honest answer. Each pattern family owns one drawing group, so re-drawing a family replaces it ' +
  'atomically and the user\'s own drawings are never touched. Offer this after romaco_detect_patterns ' +
  'or romaco_thesis finds something; call it ONLY after the user accepts. Requires <McpBridge /> ' +
  'mounted and candles loaded (romaco_load_candles), with the SAME symbol/range on the chart.';

export function registerDrawPattern(server: McpServer): void {
  server.registerTool(
    'romaco_draw_pattern',
    {
      description: DESC,
      inputSchema: {
        kind: z
          .enum(PATTERN_KINDS)
          .optional()
          .describe('Pattern kind to draw. Omit to draw the highest-confidence recent pattern of any kind.'),
        rank: z
          .number()
          .int()
          .min(0)
          .optional()
          .describe('0-based confidence rank among matching recent patterns (0 = strongest). Default 0.'),
      },
    },
    async ({ kind, rank }) => {
      // 1. Re-detect locally — same anti-drift principle as romaco_annotate.
      let candles;
      try {
        candles = session.requireCandles();
      } catch (err) {
        return { content: [{ type: 'text' as const, text: err instanceof Error ? err.message : String(err) }], isError: true };
      }
      const all = cachedDetectPatterns(candles);
      const recent = selectRecentPatterns(all, candles[0].timestamp, candles[candles.length - 1].timestamp);
      const matching = (kind ? recent.filter((p) => p.kind === kind) : recent).sort(
        (a, b) => b.confidence - a.confidence,
      );
      const hit = matching[rank ?? 0];

      // Honest guard: absence of a pattern is a valid answer, not an error.
      if (!hit) {
        const what = kind ?? 'pattern';
        return {
          content: [{
            type: 'text' as const,
            text: `No recent ${what} detected (threshold gates not met) — nothing drawn.`,
          }],
        };
      }

      // 2. Chart context: fail fast without a bridge; sniff units; guard symbol.
      let tsScale = 1;
      let visLow = Infinity;
      let visHigh = -Infinity;
      try {
        const ctx = (await bridge.getContext(true)) as {
          symbol?: string;
          visibleCandles?: Array<Record<string, unknown>>;
        };
        const vc = ctx?.visibleCandles ?? [];
        for (const c of vc) {
          const lo = Number(c.low);
          const hi = Number(c.high);
          if (Number.isFinite(lo) && lo < visLow) visLow = lo;
          if (Number.isFinite(hi) && hi > visHigh) visHigh = hi;
        }
        const chartTs = Number(vc[0]?.timestamp ?? vc[0]?.time);
        if (!vc.length || !Number.isFinite(chartTs)) {
          return {
            content: [{ type: 'text' as const, text: 'romaco_draw_pattern: the chart has no visible candles to anchor on. Load a symbol in the chart first.' }],
            isError: true,
          };
        }
        // Session candles are unix seconds; the chart speaks milliseconds.
        // Sniff instead of hardcoding — raw-source sessions may already be ms.
        if (chartTs > 1e12 && candles[0].timestamp < 1e11) tsScale = 1000;

        const sessionSymbol = session.getLastLoad()?.symbol;
        if (ctx.symbol && sessionSymbol && ctx.symbol.toUpperCase() !== sessionSymbol.toUpperCase()) {
          return {
            content: [{
              type: 'text' as const,
              text: `romaco_draw_pattern: chart shows ${ctx.symbol} but the loaded analysis is for ${sessionSymbol}. Reload matching data (romaco_load_candles or switch the chart) before drawing.`,
            }],
            isError: true,
          };
        }
      } catch (err) {
        return {
          content: [{ type: 'text' as const, text: `romaco_draw_pattern: ${err instanceof Error ? err.message : String(err)}` }],
          isError: true,
        };
      }

      const symbol = session.getLastLoad()?.symbol ?? null;
      const groupId = patternGroupId(hit.kind);

      // 3. Atomic family replace: drop OUR previous set (chart + journal);
      //    other families and the user's drawings stay.
      await bridge.executeAction({ action: 'removeDrawingsByGroup', groupId });
      chartState.removeDrawingsByGroup(groupId);

      // 4. Draw. Best-effort per drawing; journal each success so the set
      //    survives tab reloads (reconcile + localStorage rehydration).
      const drawings = mapPatternToDrawings(hit, tsScale, groupId);
      if (!drawings.length) {
        return {
          content: [{ type: 'text' as const, text: `${hit.kind} detected but it carries no drawable anchor geometry — nothing drawn.` }],
        };
      }
      let drawn = 0;
      let lastFailure: Awaited<ReturnType<typeof bridge.executeAction>> | null = null;
      for (const a of drawings) {
        const r = await bridge.executeAction(a);
        if (r.success) {
          chartState.recordDrawing(a, symbol);
          drawn++;
        } else {
          lastFailure = r;
        }
      }
      if (drawn === 0 && lastFailure) {
        const { text, isError } = enrichBridgeResult('romaco_draw_pattern', lastFailure);
        return { content: [{ type: 'text' as const, text }], isError };
      }

      // Keep the whole pattern visible: a projected target above the highs
      // (or below the lows) is clipped by the candle-only auto-fit. Pin the
      // Y range just wide enough — best-effort, mirrors romaco_annotate.
      if (Number.isFinite(visLow) && Number.isFinite(visHigh) && visHigh > visLow) {
        const levels = [hit.target_price, hit.invalidation_price].filter(
          (v): v is number => v !== undefined && Number.isFinite(v),
        );
        if (levels.length) {
          const needLow = Math.min(visLow, ...levels);
          const needHigh = Math.max(visHigh, ...levels);
          if (needLow < visLow || needHigh > visHigh) {
            const pad = (needHigh - needLow) * 0.04;
            await bridge.executeAction({ action: 'setPriceRange', min: needLow - pad, max: needHigh + pad });
          }
        }
      }

      const extras = [
        hit.target_price !== undefined ? `target ${hit.target_price.toFixed(2)}` : null,
        hit.invalidation_price !== undefined ? `invalidation ${hit.invalidation_price.toFixed(2)}` : null,
      ].filter(Boolean).join(', ');
      return {
        content: [{
          type: 'text' as const,
          text:
            `Drew ${hit.kind} (confidence ${hit.confidence.toFixed(2)}) — ${drawn} drawing(s)` +
            `${extras ? `, ${extras}` : ''}. Re-running replaces group '${groupId}'.`,
        }],
      };
    },
  );
}
