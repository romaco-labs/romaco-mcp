import type { PatternHit, PatternKind } from '../compression/types.js';
import type { BridgeAction } from '../types.js';

type AddDrawing = Extract<BridgeAction, { action: 'addDrawing' }>;

/**
 * Pure mapping: detected pattern → chart drawings.
 *
 * Every drawn point comes from the detector's emitted anchor roles — the
 * mapper never re-derives geometry from candles, so what was detected and
 * what gets drawn cannot drift.
 *
 * `tsScale` converts the detector's timestamp unit into the chart's (session
 * candles are unix seconds, the chart wants milliseconds → 1000; pass 1 when
 * the session already holds chart-unit timestamps).
 */

// Pattern geometry sits BETWEEN annotate's faint context and its bold trade
// box: clearly visible, but not shouting.
const STYLE_SHAPE: AddDrawing['style'] = { color: '#9C27B0', lineWidth: 1, lineStyle: 'solid', opacity: 0.55 };
// Trigger levels stay faint — they are derived projections, not structure.
const STYLE_TARGET: AddDrawing['style'] = { color: '#26a69a', lineWidth: 1, lineStyle: 'dotted', opacity: 0.4 };
const STYLE_INVALIDATION: AddDrawing['style'] = { color: '#ef5350', lineWidth: 1, lineStyle: 'dotted', opacity: 0.4 };

/** One group per pattern FAMILY: re-drawing a family replaces it atomically
 *  while patterns from other families stay on the chart. */
export function patternGroupId(kind: PatternKind): string {
  switch (kind) {
    case 'head_shoulders':
    case 'inverse_head_shoulders':
      return 'romaco-pattern-hs';
    case 'double_top':
    case 'double_bottom':
    case 'triple_top':
    case 'triple_bottom':
      return 'romaco-pattern-double';
    case 'ascending_triangle':
    case 'descending_triangle':
    case 'symmetric_triangle':
      return 'romaco-pattern-triangle';
    case 'bull_flag':
    case 'bear_flag':
      return 'romaco-pattern-flag';
    case 'channel_up':
    case 'channel_down':
    case 'channel_flat':
      return 'romaco-pattern-channel';
    case 'rising_wedge':
    case 'falling_wedge':
      return 'romaco-pattern-wedge';
    case 'cup_handle':
    case 'rounding_bottom':
      return 'romaco-pattern-cup';
    case 'gap_up':
    case 'gap_down':
      return 'romaco-pattern-gap';
    case 'abcd_bullish':
    case 'abcd_bearish':
    case 'gartley_bullish':
    case 'gartley_bearish':
    case 'bat_bullish':
    case 'bat_bearish':
    case 'butterfly_bullish':
    case 'butterfly_bearish':
    case 'crab_bullish':
    case 'crab_bearish':
      return 'romaco-pattern-harmonic';
  }
}

interface DrawPoint {
  timestamp: number;
  price: number;
}

function rolePoints(hit: PatternHit, role: string, tsScale: number): DrawPoint[] {
  return hit.points
    .filter((p) => p.role === role)
    .map((p) => ({ timestamp: p.ts * tsScale, price: p.price }));
}

function rolePoint(hit: PatternHit, role: string, tsScale: number): DrawPoint | null {
  const pts = rolePoints(hit, role, tsScale);
  return pts.length ? pts[0] : null;
}

function shape(
  drawingType: string,
  points: DrawPoint[],
  label: string,
  groupId: string,
  style: AddDrawing['style'] = STYLE_SHAPE,
): AddDrawing {
  return { action: 'addDrawing', drawingType, points, label, style, groupId };
}

/** Map a detected pattern to its minimal-honest set of chart drawings. */
export function mapPatternToDrawings(hit: PatternHit, tsScale: number, groupId: string): AddDrawing[] {
  const out: AddDrawing[] = [];
  const lastTs = hit.points.length ? Math.max(...hit.points.map((p) => p.ts)) * tsScale : 0;

  switch (hit.kind) {
    case 'head_shoulders':
    case 'inverse_head_shoulders': {
      const ls = rolePoint(hit, 'left_shoulder', tsScale);
      const head = rolePoint(hit, 'head', tsScale);
      const rs = rolePoint(hit, 'right_shoulder', tsScale);
      const nl = rolePoint(hit, 'neckline_left', tsScale);
      const nr = rolePoint(hit, 'neckline_right', tsScale);
      if (nl && nr) out.push(shape('trendline', [nl, nr], `${hit.kind} neckline`, groupId));
      if (ls && nl && head && nr && rs) {
        out.push(shape('path', [ls, nl, head, nr, rs], hit.kind, groupId));
      }
      break;
    }

    case 'double_top':
    case 'double_bottom': {
      // The M / W silhouette through the three structural pivots + the
      // horizontal neckline at the middle pivot (the breakout trigger).
      const isTop = hit.kind === 'double_top';
      const silhouette = (isTop ? ['top_1', 'valley', 'top_2'] : ['bottom_1', 'peak', 'bottom_2'])
        .map((r) => rolePoint(hit, r, tsScale));
      const neckline = rolePoint(hit, isTop ? 'valley' : 'peak', tsScale);
      if (silhouette.every((p) => p !== null)) {
        out.push(shape('path', silhouette as DrawPoint[], hit.kind, groupId));
      }
      if (neckline) {
        out.push(
          shape('horizontalLine', [neckline], `${hit.kind} neckline`, groupId, {
            ...STYLE_SHAPE,
            lineStyle: 'dashed',
            opacity: 0.4,
          }),
        );
      }
      break;
    }

    case 'triple_top':
    case 'triple_bottom': {
      const isTop = hit.kind === 'triple_top';
      const roles = isTop
        ? ['top_1', 'valley_1', 'top_2', 'valley_2', 'top_3']
        : ['bottom_1', 'peak_1', 'bottom_2', 'peak_2', 'bottom_3'];
      const silhouette = roles.map((r) => rolePoint(hit, r, tsScale));
      if (silhouette.every((p) => p !== null)) {
        out.push(shape('path', silhouette as DrawPoint[], hit.kind, groupId));
      }
      // Neckline = the FAR valley/peak (detector convention: full break only).
      const necks = (isTop ? ['valley_1', 'valley_2'] : ['peak_1', 'peak_2'])
        .map((r) => rolePoint(hit, r, tsScale))
        .filter((p): p is DrawPoint => p !== null);
      if (necks.length) {
        const neckline = isTop
          ? necks.reduce((a, b) => (a.price <= b.price ? a : b))
          : necks.reduce((a, b) => (a.price >= b.price ? a : b));
        out.push(
          shape('horizontalLine', [neckline], `${hit.kind} neckline`, groupId, {
            ...STYLE_SHAPE,
            lineStyle: 'dashed',
            opacity: 0.4,
          }),
        );
      }
      break;
    }

    case 'ascending_triangle':
    case 'descending_triangle':
    case 'symmetric_triangle': {
      // Triangle hits carry up to 4 mixed swing points with role 'high'/'low'.
      // A side needs >= 2 points for a line; draw whichever sides qualify.
      const highs = rolePoints(hit, 'high', tsScale);
      const lows = rolePoints(hit, 'low', tsScale);
      if (highs.length >= 2) {
        out.push(shape('trendline', [highs[0], highs[highs.length - 1]], `${hit.kind} upper`, groupId));
      }
      if (lows.length >= 2) {
        out.push(shape('trendline', [lows[0], lows[lows.length - 1]], `${hit.kind} lower`, groupId));
      }
      break;
    }

    case 'bull_flag':
    case 'bear_flag': {
      const a = rolePoint(hit, 'impulse_start', tsScale);
      const b = rolePoint(hit, 'impulse_end', tsScale);
      const c = rolePoint(hit, 'flag_end', tsScale);
      // Only closes are known — a polyline is honest, a rectangle would invent a band.
      if (a && b && c) out.push(shape('path', [a, b, c], hit.kind, groupId));
      break;
    }

    case 'channel_up':
    case 'channel_down':
    case 'channel_flat': {
      // parallelChannel template: P0/P1 = base line, P2 = offset point the
      // parallel line passes through — exactly the detector's emitted roles.
      const p0 = rolePoint(hit, 'base_start', tsScale);
      const p1 = rolePoint(hit, 'base_end', tsScale);
      const p2 = rolePoint(hit, 'offset', tsScale);
      if (p0 && p1 && p2) out.push(shape('parallelChannel', [p0, p1, p2], hit.kind, groupId));
      break;
    }

    case 'rising_wedge':
    case 'falling_wedge': {
      const us = rolePoint(hit, 'upper_start', tsScale);
      const ue = rolePoint(hit, 'upper_end', tsScale);
      const ls = rolePoint(hit, 'lower_start', tsScale);
      const le = rolePoint(hit, 'lower_end', tsScale);
      if (us && ue) out.push(shape('trendline', [us, ue], `${hit.kind} upper`, groupId));
      if (ls && le) out.push(shape('trendline', [ls, le], `${hit.kind} lower`, groupId));
      break;
    }

    case 'abcd_bullish':
    case 'abcd_bearish': {
      // The chart's native `abcd` template renders the classic connected legs
      // with vertex labels — feed it the four pivots in order.
      const pts = ['A', 'B', 'C', 'D'].map((r) => rolePoint(hit, r, tsScale));
      if (pts.every((p) => p !== null)) {
        out.push(shape('abcd', pts as DrawPoint[], hit.kind, groupId));
      }
      break;
    }

    case 'gartley_bullish':
    case 'gartley_bearish':
    case 'bat_bullish':
    case 'bat_bearish':
    case 'butterfly_bullish':
    case 'butterfly_bearish':
    case 'crab_bullish':
    case 'crab_bearish': {
      // Native `xabcd` template: the two connected triangles (X-A-B, B-C-D).
      const pts = ['X', 'A', 'B', 'C', 'D'].map((r) => rolePoint(hit, r, tsScale));
      if (pts.every((p) => p !== null)) {
        out.push(shape('xabcd', pts as DrawPoint[], hit.kind, groupId));
      }
      break;
    }

    case 'cup_handle': {
      // The bowl: detector-fitted parabola samples. The handle: rim → low → end.
      const arc = rolePoints(hit, 'arc', tsScale);
      if (arc.length >= 3) out.push(shape('path', arc, 'cup', groupId));
      const rr = rolePoint(hit, 'right_rim', tsScale);
      const hl = rolePoint(hit, 'handle_low', tsScale);
      const he = rolePoint(hit, 'handle_end', tsScale);
      if (rr && hl && he) out.push(shape('path', [rr, hl, he], 'handle', groupId));
      const lr = rolePoint(hit, 'left_rim', tsScale);
      if (lr && rr) {
        out.push(
          shape('horizontalLine', [rr], 'cup rim', groupId, { ...STYLE_SHAPE, lineStyle: 'dashed', opacity: 0.4 }),
        );
      }
      break;
    }

    case 'rounding_bottom': {
      // The bowl arc plus a dashed rim line at the breakout level.
      const arc = rolePoints(hit, 'arc', tsScale);
      if (arc.length >= 3) out.push(shape('path', arc, hit.kind, groupId));
      const rim = rolePoint(hit, 'rim_left', tsScale);
      if (rim) {
        out.push(
          shape('horizontalLine', [rim], `${hit.kind} rim`, groupId, { ...STYLE_SHAPE, lineStyle: 'dashed', opacity: 0.4 }),
        );
      }
      break;
    }

    case 'gap_up':
    case 'gap_down': {
      // The open gap zone as a translucent rectangle between the two edges.
      const lo = rolePoint(hit, 'gap_low', tsScale);
      const hi2 = rolePoint(hit, 'gap_high', tsScale);
      if (lo && hi2) {
        out.push(
          shape('rectangle', [lo, hi2], hit.kind, groupId, {
            ...STYLE_SHAPE,
            opacity: 0.45,
            fillColor: 'rgba(156,39,176,0.14)',
          }),
        );
      }
      break;
    }
  }

  // Derived projections (faint): drawn for every kind that reports them.
  if (out.length > 0 && lastTs > 0) {
    if (hit.target_price !== undefined && Number.isFinite(hit.target_price)) {
      out.push(
        shape('horizontalLine', [{ timestamp: lastTs, price: hit.target_price }], `${hit.kind} target`, groupId, STYLE_TARGET),
      );
    }
    if (hit.invalidation_price !== undefined && Number.isFinite(hit.invalidation_price)) {
      out.push(
        shape(
          'horizontalLine',
          [{ timestamp: lastTs, price: hit.invalidation_price }],
          `${hit.kind} invalidation`,
          groupId,
          STYLE_INVALIDATION,
        ),
      );
    }
  }

  return out;
}
