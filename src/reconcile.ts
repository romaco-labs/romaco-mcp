import { bridge } from './bridge.js';
import { session } from './session.js';
import { chartState } from './chartState.js';
import type { BridgeAction } from './types.js';

/**
 * Reconcile-on-`ready`: when a (possibly fresh) browser chart connects, replay
 * the overlays the agent applied earlier so they survive chart re-creation.
 *
 * It diffs the desired state (chartState journal) against what the chart
 * actually has right now (bridge.getContext) and applies only the missing
 * overlays. That makes it idempotent:
 *   - fresh chart  → context empty → everything replayed
 *   - same chart   → context already has them → nothing re-applied (no doubles)
 *
 * Scope (see plan): indicators replay always (symbol-agnostic — they recompute
 * on whatever data is loaded). Drawings/alerts replay only when the loaded
 * symbol matches the one they were drawn on, since they anchor to timestamp/price.
 */

// Minimal shapes of what getContext returns (the chart's ChartContext). We only
// read the few fields needed to diff; the bridge types it as `unknown`.
interface ContextIndicator { name: string; params: number[] }
interface ContextDrawing { type: string; points: Array<{ timestamp: number; price: number }> }
interface ContextAlert { price: number; direction?: string }
interface ReconcileContext {
  symbol?: string | null;
  existingIndicators?: ContextIndicator[];
  existingDrawings?: ContextDrawing[];
  alerts?: ContextAlert[];
  totalCandles?: number;
}

// The browser announces `ready` on socket OPEN — often before the chart exists
// or finished loading its data (tab reload while candles are still fetching).
// A single getContext attempt at that moment fails with "Chart not ready" and
// the whole replay used to be silently skipped. Poll until the chart is
// genuinely ready to anchor overlays.
const READY_RETRY_DELAY_MS = 1_500;
const READY_RETRY_ATTEMPTS = 8;

// Each `ready` bumps the generation; an in-flight retry loop from an older
// `ready` aborts itself so two replays never interleave.
let generation = 0;

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

export interface ReconcileOptions {
  attempts?: number;
  delayMs?: number;
}

const numEq = (a: number, b: number): boolean => Math.abs(a - b) < 1e-9;

function paramsEq(a: number[] = [], b: number[] = []): boolean {
  return a.length === b.length && a.every((v, i) => numEq(v, b[i]));
}

function hasIndicator(existing: ContextIndicator[], want: Extract<BridgeAction, { action: 'addIndicator' }>): boolean {
  return existing.some(
    (e) => e.name?.toLowerCase() === want.indicatorType.toLowerCase() && paramsEq(e.params ?? [], want.params ?? []),
  );
}

function pointsEq(
  a: Array<{ timestamp: number; price: number }> = [],
  b: Array<{ timestamp: number; price: number }> = [],
): boolean {
  return a.length === b.length && a.every((p, i) => numEq(p.timestamp, b[i].timestamp) && numEq(p.price, b[i].price));
}

function hasDrawing(existing: ContextDrawing[], want: Extract<BridgeAction, { action: 'addDrawing' }>): boolean {
  return existing.some((e) => e.type?.toLowerCase() === want.drawingType.toLowerCase() && pointsEq(e.points, want.points));
}

// add_alert defaults an omitted direction to "cross", so normalize for matching.
const dir = (d?: string): string => d ?? 'cross';

function hasAlert(existing: ContextAlert[], want: Extract<BridgeAction, { action: 'addAlert' }>): boolean {
  return existing.some((e) => numEq(e.price, want.price) && dir(e.direction) === dir(want.options?.direction));
}

/** Best-effort apply: one failed overlay must not abort the rest of the replay. */
async function tryApply(action: BridgeAction): Promise<void> {
  try {
    await bridge.executeAction(action);
  } catch (err) {
    console.error(`[romaco-mcp] reconcile: failed to re-apply ${action.action}: ${err instanceof Error ? err.message : String(err)}`);
  }
}

export async function reconcileChartState(opts: ReconcileOptions = {}): Promise<void> {
  const attempts = opts.attempts ?? READY_RETRY_ATTEMPTS;
  const delayMs = opts.delayMs ?? READY_RETRY_DELAY_MS;
  const gen = ++generation;

  const want = chartState.snapshot();
  if (!want.indicators.length && !want.drawings.length && !want.alerts.length) return;

  let ctx: ReconcileContext | null = null;
  let lastErr: unknown = null;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      const candidate = (await bridge.getContext(false)) as ReconcileContext;
      // totalCandles === 0 → chart shell exists but its data hasn't loaded yet;
      // drawings would anchor onto nothing. Older browser builds without the
      // field are assumed ready (pre-fix behavior).
      if (candidate.totalCandles === undefined || candidate.totalCandles > 0) {
        ctx = candidate;
        break;
      }
      lastErr = new Error('chart has no candles loaded yet');
    } catch (err) {
      lastErr = err;
    }
    if (gen !== generation) return; // superseded by a newer `ready`
    if (attempt < attempts) await sleep(delayMs);
  }
  if (gen !== generation) return;
  if (ctx === null) {
    console.error(
      `[romaco-mcp] reconcile: chart not ready after ${attempts} attempt(s), skipping: ${lastErr instanceof Error ? lastErr.message : String(lastErr)}`,
    );
    return;
  }

  const existingIndicators = ctx.existingIndicators ?? [];
  const existingDrawings = ctx.existingDrawings ?? [];
  const existingAlerts = ctx.alerts ?? [];
  // Use the chart's actual loaded symbol (from context) rather than the session's
  // last-load record, which can be stale if the user changed symbols in the browser.
  const symbol = ctx.symbol ?? session.getLastLoad()?.symbol ?? null;

  // Indicators: replay always (symbol-agnostic).
  for (const e of want.indicators) {
    const a = e.action as Extract<BridgeAction, { action: 'addIndicator' }>;
    if (!hasIndicator(existingIndicators, a)) await tryApply(a);
  }

  // Drawings/alerts: only when the current symbol matches the one they anchor to.
  for (const e of want.drawings) {
    if (e.symbol !== symbol) continue;
    const a = e.action as Extract<BridgeAction, { action: 'addDrawing' }>;
    if (!hasDrawing(existingDrawings, a)) await tryApply(a);
  }
  for (const e of want.alerts) {
    if (e.symbol !== symbol) continue;
    const a = e.action as Extract<BridgeAction, { action: 'addAlert' }>;
    if (!hasAlert(existingAlerts, a)) await tryApply(a);
  }
}
