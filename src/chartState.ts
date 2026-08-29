import type { BridgeAction } from './types.js';
import type { ChartIdentity } from './domain/chart/model.js';

/**
 * Desired-state journal for chart mutations applied via the MCP bridge.
 *
 * Why this exists: the browser chart instance is the only place an applied
 * indicator/drawing/alert actually lives. When that instance is re-created or
 * swapped (symbol change, grid-layout change, tab reconnect, HMR) every overlay
 * the agent added is lost. The bridge is a stateless request/response pipe, so
 * without a record of *what was applied* the server cannot restore it.
 *
 * This journal records the successful bridge actions verbatim so they can be
 * replayed on the next `ready` (see reconcile.ts). Single-tenant — one journal
 * per MCP process, matching the stdio model (see session.ts).
 */

/** A recorded action plus the symbol that was loaded when it was applied. */
export interface JournalEntry {
  action: BridgeAction;
  /** Symbol active at record time. null = applied with no data loaded. */
  symbol: string | null;
  /** Canonical live identity when recorded through an identity-aware workflow. */
  identity?: ChartIdentity;
  /** Browser resource id returned by the most recent successful apply. */
  resourceId?: string;
  /** Atomic group resources returned by the most recent successful apply. */
  resourceIds?: readonly string[];
}

export interface JournalSnapshot {
  indicators: JournalEntry[];
  drawings: JournalEntry[];
  drawingGroups: JournalEntry[];
  alerts: JournalEntry[];
}

/** Stable identity for an addIndicator action: type (case-insensitive) + params. */
function indicatorKey(a: Extract<BridgeAction, { action: 'addIndicator' }>): string {
  return `${a.indicatorType.toLowerCase()}:${(a.params ?? []).join(',')}`;
}

function hasIdentity(entry: JournalEntry, identity: ChartIdentity): boolean {
  return entry.identity?.chartId === identity.chartId
    && entry.identity.symbol === identity.symbol
    && entry.identity.timeframe === identity.timeframe
    && entry.identity.datasetId === identity.datasetId;
}

function sameIdentity(left: ChartIdentity | undefined, right: ChartIdentity): boolean {
  return left?.chartId === right.chartId
    && left.symbol === right.symbol
    && left.timeframe === right.timeframe;
}

export class ChartStateJournal {
  private indicators: JournalEntry[] = [];
  private drawings: JournalEntry[] = [];
  private drawingGroups: JournalEntry[] = [];
  private alerts: JournalEntry[] = [];
  private revision = 0;

  structuralRevision(): number {
    return this.revision;
  }

  /** Record an applied indicator. Deduped by type+params so replays never stack. */
  recordIndicator(
    action: Extract<BridgeAction, { action: 'addIndicator' }>,
    identityOrSymbol: ChartIdentity | string | null,
    resourceId?: string,
  ): void {
    const key = indicatorKey(action);
    const identity = typeof identityOrSymbol === 'object' && identityOrSymbol !== null
      ? identityOrSymbol
      : undefined;
    const symbol = identity
      ? identity.symbol ?? null
      : identityOrSymbol as string | null;
    const existing = this.indicators.findIndex(
      (entry) => (
        indicatorKey(entry.action as Extract<BridgeAction, { action: 'addIndicator' }>) === key
        && (identity === undefined || sameIdentity(entry.identity, identity))
      ),
    );
    const next: JournalEntry = {
      action,
      symbol,
      ...(identity ? { identity: { ...identity } } : {}),
      ...(resourceId ? { resourceId } : {}),
    };
    if (existing !== -1) {
      this.indicators[existing] = next;
      this.revision += 1;
      return;
    }
    this.indicators.push(next);
    this.revision += 1;
  }

  recordDrawing(
    action: Extract<BridgeAction, { action: 'addDrawing' }>,
    identity: ChartIdentity,
    resourceId?: string,
  ): void {
    this.drawings.push({
      action,
      symbol: identity.symbol ?? null,
      identity: { ...identity },
      ...(resourceId ? { resourceId } : {}),
    });
    this.revision += 1;
  }

  recordAlert(
    action: Extract<BridgeAction, { action: 'addAlert' }>,
    identity: ChartIdentity,
    resourceId?: string,
  ): void {
    this.alerts.push({
      action,
      symbol: identity.symbol ?? null,
      identity: { ...identity },
      ...(resourceId ? { resourceId } : {}),
    });
    this.revision += 1;
  }

  /** Store one complete desired atomic group, never N independently replayed adds. */
  replaceDrawingGroup(
    action: Extract<BridgeAction, { action: 'replaceAgentDrawingGroup' }>,
    identity: ChartIdentity,
    resourceIds: readonly string[] = [],
  ): void {
    this.removeDrawingsByGroup(action.groupId, identity);
    this.drawingGroups.push({
      action,
      symbol: identity.symbol ?? null,
      identity: { ...identity },
      resourceIds: [...resourceIds],
    });
    this.revision += 1;
  }

  /** Mirror the clearDrawings bridge action so reconcile won't re-add them. */
  clearDrawings(): void {
    if (this.drawings.length === 0 && this.drawingGroups.length === 0) return;
    this.drawings = [];
    this.drawingGroups = [];
    this.revision += 1;
  }

  /** Drop journaled drawings in a group so reconcile won't replay a replaced set. */
  removeDrawingsByGroup(groupId: string, identity?: ChartIdentity): void {
    const before = this.drawings.length + this.drawingGroups.length;
    this.drawings = this.drawings.filter(
      (entry) => (
        (entry.action as Extract<BridgeAction, { action: 'addDrawing' }>).groupId !== groupId
        || (identity !== undefined && !sameIdentity(entry.identity, identity))
      ),
    );
    this.drawingGroups = this.drawingGroups.filter(
      (entry) => (
        (entry.action as Extract<BridgeAction, { action: 'replaceAgentDrawingGroup' }>).groupId !== groupId
        || (identity !== undefined && !sameIdentity(entry.identity, identity))
      ),
    );
    if (this.drawings.length + this.drawingGroups.length !== before) this.revision += 1;
  }

  /** Drop one group's desired state only for exact chart identity. */
  removeDrawingsByGroupForIdentity(groupId: string, identity: ChartIdentity): void {
    const before = this.drawings.length + this.drawingGroups.length;
    this.drawings = this.drawings.filter((entry) => {
      const action = entry.action as Extract<BridgeAction, { action: 'addDrawing' }>;
      return action.groupId !== groupId || !hasIdentity(entry, identity);
    });
    this.drawingGroups = this.drawingGroups.filter((entry) => {
      const action = entry.action as Extract<BridgeAction, { action: 'replaceAgentDrawingGroup' }>;
      return action.groupId !== groupId || !hasIdentity(entry, identity);
    });
    if (this.drawings.length + this.drawingGroups.length !== before) this.revision += 1;
  }

  /** Immutable view of the desired state, for the reconciler. */
  snapshot(): JournalSnapshot {
    return {
      indicators: [...this.indicators],
      drawings: [...this.drawings],
      drawingGroups: [...this.drawingGroups],
      alerts: [...this.alerts],
    };
  }

  clearAlerts(): void {
    if (this.alerts.length === 0) return;
    this.alerts = [];
    this.revision += 1;
  }

  removeAlert(resourceId: string, price: number, direction: string): void {
    const exact = this.alerts.findIndex((entry) => entry.resourceId === resourceId);
    const fallback = this.alerts.findIndex((entry) => {
      const action = entry.action as Extract<BridgeAction, { action: 'addAlert' }>;
      return action.price === price && (action.options?.direction ?? 'cross') === direction;
    });
    const index = exact >= 0 ? exact : fallback;
    if (index >= 0) {
      this.alerts.splice(index, 1);
      this.revision += 1;
    }
  }

  removeIndicator(resourceId: string, indicatorType: string, params: number[] = []): void {
    const exact = this.indicators.findIndex((entry) => entry.resourceId === resourceId);
    const key = `${indicatorType.toLowerCase()}:${params.join(',')}`;
    const fallback = this.indicators.findIndex((entry) =>
      indicatorKey(entry.action as Extract<BridgeAction, { action: 'addIndicator' }>) === key,
    );
    const index = exact >= 0 ? exact : fallback;
    if (index >= 0) {
      this.indicators.splice(index, 1);
      this.revision += 1;
    }
  }

  bindResourceId(action: BridgeAction, resourceId: string, identity?: ChartIdentity): void {
    let entries: JournalEntry[] = [];
    let match: (entry: JournalEntry) => boolean = () => false;
    if (action.action === 'addIndicator') {
      entries = this.indicators;
      const key = indicatorKey(action);
      match = (entry) => indicatorKey(entry.action as Extract<BridgeAction, { action: 'addIndicator' }>) === key;
    } else if (action.action === 'addAlert') {
      entries = this.alerts;
      match = (entry) => {
        const candidate = entry.action as Extract<BridgeAction, { action: 'addAlert' }>;
        return candidate.price === action.price
          && (candidate.options?.direction ?? 'cross') === (action.options?.direction ?? 'cross');
      };
    } else if (action.action === 'addDrawing') {
      entries = this.drawings;
      match = (entry) => {
        const candidate = entry.action as Extract<BridgeAction, { action: 'addDrawing' }>;
        return candidate.groupId === action.groupId
          && candidate.drawingType === action.drawingType
          && JSON.stringify(candidate.points) === JSON.stringify(action.points);
      };
    }
    const entry = entries.find((candidate) => (
      match(candidate) && (identity === undefined || sameIdentity(candidate.identity, identity))
    ));
    if (entry) entry.resourceId = resourceId;
  }

  bindResourceIds(action: BridgeAction, resourceIds: readonly string[], identity?: ChartIdentity): void {
    if (action.action !== 'replaceAgentDrawingGroup') return;
    const entry = this.drawingGroups.find((candidate) =>
      candidate.action.action === 'replaceAgentDrawingGroup'
      && candidate.action.groupId === action.groupId
      && candidate.action.idempotencyKey === action.idempotencyKey
      && (identity === undefined || sameIdentity(candidate.identity, identity))
    );
    if (entry) entry.resourceIds = [...resourceIds];
  }

  /** Reset everything. Used by tests. */
  clear(): void {
    const changed = this.indicators.length > 0
      || this.drawings.length > 0
      || this.drawingGroups.length > 0
      || this.alerts.length > 0;
    this.indicators = [];
    this.drawings = [];
    this.drawingGroups = [];
    this.alerts = [];
    if (changed) this.revision += 1;
  }
}

export const chartState = new ChartStateJournal();
