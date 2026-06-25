import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { bridge } from '../bridge.js';
import { session } from '../session.js';
import { chartState } from '../chartState.js';
import { enrichBridgeResult } from './_guards.js';
import { analyzeSession } from '../compression/analyze.js';
import type { MarketSummary, PatternHit } from '../compression/types.js';
import type { BridgeAction } from '../types.js';

type AddDrawing = Extract<BridgeAction, { action: 'addDrawing' }>;

// All annotate drawings share one group, so a re-annotate replaces just this set
// (group-scoped removal) and the user's own drawings are left untouched.
const GROUP = 'romaco-thesis';
const RECENT_FRACTION = 0.25; // mirror thesis.ts pattern recency gate
const ZONE_ATR_FRAC = 0.25; // entry-zone half-band, in ATR units

// Tier styles — FAINT context vs the bold longPosition box (which paints its own
// colors). Mirrored in examples/_stop-repro.html for the hierarchy snapshot.
const FAINT = '#9598a1';
const STYLE_LEVEL: AddDrawing['style'] = { color: FAINT, lineWidth: 1, lineStyle: 'dashed', opacity: 0.3 };
const STYLE_POC: AddDrawing['style'] = { color: FAINT, lineWidth: 1, lineStyle: 'dotted', opacity: 0.3 };
const STYLE_PATTERN: AddDrawing['style'] = { color: FAINT, lineWidth: 1, lineStyle: 'dotted', opacity: 0.4 };
const STYLE_ZONE: AddDrawing['style'] = {
  color: '#2962ff', lineWidth: 1, lineStyle: 'solid', opacity: 0.5, fillColor: 'rgba(41,98,255,0.12)',
};

const ANNOTATE_DESC =
  "Annotate the latest locally-computed trade thesis on the user's browser chart with VISUAL " +
  'HIERARCHY: support/resistance and the detected pattern are drawn FAINT (gray, dashed/dotted, ' +
  'low opacity) as context; the entry zone is a soft band; entry/stop/target are the BOLD action ' +
  '(longPosition/shortPosition with built-in reward/risk). Honest guard: if the verdict is ' +
  'stand_aside it draws ONLY context and never invents an entry/stop/target. Re-running replaces ' +
  "the previous annotation (group 'romaco-thesis') and leaves the user's own drawings untouched. " +
  'Call this ONLY after the user accepts the offer to draw. Requires <McpBridge /> mounted and ' +
  'candles loaded (romaco_setup_chart or romaco_load_candles).';

const fmt = (n: number): string => n.toFixed(2);

function line(price: number, label: string, ts: number, style: AddDrawing['style']): AddDrawing {
  return { action: 'addDrawing', drawingType: 'horizontalLine', points: [{ timestamp: ts, price }], label, style, groupId: GROUP };
}

/** Highest-confidence recent pattern (mirrors thesis recency; skips await-breakout triangle). */
function topRecentPattern(summary: MarketSummary): PatternHit | null {
  const span = summary.meta.last_ts - summary.meta.first_ts;
  const cut = span > 0 ? summary.meta.last_ts - RECENT_FRACTION * span : -Infinity;
  let best: PatternHit | null = null;
  for (const p of summary.patterns) {
    if (p.kind === 'symmetric_triangle') continue;
    const latest = p.points.length ? Math.max(...p.points.map((pt) => pt.ts)) : 0;
    if (latest < cut) continue;
    if (!best || p.confidence > best.confidence) best = p;
  }
  return best;
}

export function registerAnnotate(server: McpServer): void {
  server.registerTool('romaco_annotate', { description: ANNOTATE_DESC }, async () => {
    // 1. Locally-computed analysis — verdict + levels + pattern + setup from the
    //    SAME MarketSummary, so what was said and what gets drawn cannot drift.
    let analysis: ReturnType<typeof analyzeSession>;
    try {
      analysis = analyzeSession(session.requireCandles());
    } catch (err) {
      return { content: [{ type: 'text' as const, text: err instanceof Error ? err.message : String(err) }], isError: true };
    }
    const { summary, thesis } = analysis;

    // 2. X anchor from the CHART, never the MCP session candle unit (seconds vs
    //    the host's ms). Fail-fast here if no chart / bridge.
    let anchorTs: number;
    let zoneLeftTs: number;
    let visLow = Infinity;
    let visHigh = -Infinity;
    try {
      const ctx = (await bridge.getContext(true)) as { visibleCandles?: Array<Record<string, unknown>> };
      const vc = ctx?.visibleCandles ?? [];
      const last = vc[vc.length - 1];
      anchorTs = Number(last?.timestamp ?? last?.time);
      const left = vc[Math.max(0, vc.length - 20)];
      zoneLeftTs = Number(left?.timestamp ?? left?.time);
      if (!vc.length || !Number.isFinite(anchorTs)) {
        return { content: [{ type: 'text' as const, text: 'romaco_annotate: the chart has no visible candles to anchor on. Load a symbol in the chart first.' }], isError: true };
      }
      if (!Number.isFinite(zoneLeftTs)) zoneLeftTs = anchorTs;
      for (const c of vc) {
        const lo = Number(c.low);
        const hi = Number(c.high);
        if (Number.isFinite(lo) && lo < visLow) visLow = lo;
        if (Number.isFinite(hi) && hi > visHigh) visHigh = hi;
      }
    } catch (err) {
      return { content: [{ type: 'text' as const, text: `romaco_annotate: ${err instanceof Error ? err.message : String(err)}` }], isError: true };
    }

    const symbol = session.getLastLoad()?.symbol ?? null;

    // 3. Re-annotate cleanly: drop OUR previous group (chart + journal); the
    //    user's own drawings stay. Best-effort (older browsers may not know it).
    await bridge.executeAction({ action: 'removeDrawingsByGroup', groupId: GROUP });
    chartState.removeDrawingsByGroup(GROUP);

    // 4. Context tiers (FAINT) — drawn whether or not there is a tradable setup.
    const L = summary.levels;
    const context: AddDrawing[] = [];
    for (const s of L.support) context.push(line(s, `S ${fmt(s)}`, anchorTs, STYLE_LEVEL));
    for (const r of L.resistance) context.push(line(r, `R ${fmt(r)}`, anchorTs, STYLE_LEVEL));
    if (Number.isFinite(L.poc) && L.poc > 0) context.push(line(L.poc, `POC ${fmt(L.poc)}`, anchorTs, STYLE_POC));
    const pat = topRecentPattern(summary);
    if (pat && Number.isFinite(pat.invalidation_price)) {
      context.push(line(pat.invalidation_price as number, `${pat.kind} invalidation`, anchorTs, STYLE_PATTERN));
    }

    let drawn = 0;
    for (const a of context) {
      const r = await bridge.executeAction(a);
      if (r.success) { chartState.recordDrawing(a, symbol); drawn++; }
    }

    // 5. Action tiers (entry zone + bold box) — ONLY with a real setup. Honest
    //    guard: never paint a trade the thesis did not recommend.
    const setup = thesis.setup;
    if (thesis.verdict !== 'stand_aside' && setup != null) {
      const atr = summary.volatility.atr;
      if (atr > 0) {
        const band = ZONE_ATR_FRAC * atr;
        const far = thesis.verdict === 'long' ? setup.entry - band : setup.entry + band;
        const zone: AddDrawing = {
          action: 'addDrawing',
          drawingType: 'rectangle',
          points: [{ timestamp: zoneLeftTs, price: setup.entry }, { timestamp: anchorTs, price: far }],
          label: 'entry zone',
          style: STYLE_ZONE,
          groupId: GROUP,
        };
        const rz = await bridge.executeAction(zone);
        if (rz.success) { chartState.recordDrawing(zone, symbol); drawn++; }
      }

      // Anchor the box ~20 bars back (zoneLeftTs) so it renders over visible
      // candles instead of hanging off the right edge into the future.
      const box: AddDrawing = {
        action: 'addDrawing',
        drawingType: thesis.verdict === 'long' ? 'longPosition' : 'shortPosition',
        points: [
          { timestamp: zoneLeftTs, price: setup.entry },
          { timestamp: zoneLeftTs, price: setup.stop },
          { timestamp: zoneLeftTs, price: setup.target },
        ],
        label: `${thesis.verdict.toUpperCase()} · R/R ${setup.rr}`,
        groupId: GROUP,
      };
      const rb = await bridge.executeAction(box);
      if (!rb.success) {
        const { text, isError } = enrichBridgeResult('romaco_annotate', rb);
        return { content: [{ type: 'text' as const, text }], isError };
      }
      chartState.recordDrawing(box, symbol);
      drawn++;

      // Make the whole trade visible: a target above the highs (or a stop
      // below the lows) is clipped by the candle-only auto-fit. Pin the Y
      // range just wide enough — best-effort, older browser builds ignore it.
      if (Number.isFinite(visLow) && Number.isFinite(visHigh) && visHigh > visLow) {
        const needLow = Math.min(visLow, setup.stop, setup.target);
        const needHigh = Math.max(visHigh, setup.stop, setup.target);
        if (needLow < visLow || needHigh > visHigh) {
          const pad = (needHigh - needLow) * 0.04;
          await bridge.executeAction({ action: 'setPriceRange', min: needLow - pad, max: needHigh + pad });
        }
      }

      const patternOffer = pat
        ? ` A ${pat.kind} was detected — romaco_draw_pattern can draw its geometry (offer it, don't auto-call).`
        : '';
      return {
        content: [{
          type: 'text' as const,
          text: `Annotated ${thesis.verdict}: entry ${setup.entry} / stop ${setup.stop} / target ${setup.target} (R/R ${setup.rr}); ${drawn} layers — faint = context, bold box = the trade.${patternOffer}`,
        }],
      };
    }

    // Honest guard: standing aside — context only (if any), never a setup.
    const text = drawn > 0
      ? `Standing aside — drew ${drawn} context layer(s) (levels/pattern) only, no entry/stop/target.`
      : 'Standing aside — nothing actionable to draw.';
    return { content: [{ type: 'text' as const, text }] };
  });
}
