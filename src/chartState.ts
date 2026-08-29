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

class ChartStateJournal {
  private indicators: JournalEntry[] = [];
  private drawings: JournalEntry[] = [];
  private drawingGroups: JournalEntry[] = [];
  private alerts: JournalEntry[] = [];

  /** Record an applied indicator. Deduped by type+params so replays never stack. */
  recordIndicator(
    action: Extract<BridgeAction, { action: 'addIndicator' }>,
    symbol: string | null,
    resourceId?: string,
  ): void {
    const key = indicatorKey(action);
    const existing = this.indicators.findIndex(
      (e) => indicatorKey(e.action as Extract<BridgeAction, { action: 'addIndicator' }>) === key,
    );
    if (existing !== -1) {
      // Refresh the symbol so the most-recent context wins; indicators replay
      // regardless of symbol, so this is mostly bookkeeping.
      this.indicators[existing] = resourceId
        ? { action, symbol, resourceId }
        : { action, symbol };
      return;
    }
    this.indicators.push(resourceId ? { action, symbol, resourceId } : { action, symbol });
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
  }

  /** Store one complete desired atomic group, never N independently replayed adds. */
  replaceDrawingGroup(
    action: Extract<BridgeAction, { action: 'replaceAgentDrawingGroup' }>,
    identity: ChartIdentity,
    resourceIds: readonly string[] = [],
  ): void {
    this.removeDrawingsByGroup(action.groupId);
    this.drawingGroups.push({
      action,
      symbol: identity.symbol ?? null,
      identity: { ...identity },
      resourceIds: [...resourceIds],
    });
  }

  /** Mirror the clearDrawings bridge action so reconcile won't re-add them. */
  clearDrawings(): void {
    this.drawings = [];
    this.drawingGroups = [];
  }

  /** Drop journaled drawings in a group so reconcile won't replay a replaced set. */
  removeDrawingsByGroup(groupId: string): void {
    this.drawings = this.drawings.filter(
      (e) => (e.action as Extract<BridgeAction, { action: 'addDrawing' }>).groupId !== groupId,
    );
    this.drawingGroups = this.drawingGroups.filter(
      (entry) => (entry.action as Extract<BridgeAction, { action: 'replaceAgentDrawingGroup' }>).groupId !== groupId,
    );
  }

  /** Drop one group's desired state only for exact chart identity. */
  removeDrawingsByGroupForIdentity(groupId: string, identity: ChartIdentity): void {
    this.drawings = this.drawings.filter((entry) => {
      const action = entry.action as Extract<BridgeAction, { action: 'addDrawing' }>;
      return action.groupId !== groupId || !hasIdentity(entry, identity);
    });
    this.drawingGroups = this.drawingGroups.filter((entry) => {
      const action = entry.action as Extract<BridgeAction, { action: 'replaceAgentDrawingGroup' }>;
      return action.groupId !== groupId || !hasIdentity(entry, identity);
    });
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
    this.alerts = [];
  }

  removeAlert(resourceId: string, price: number, direction: string): void {
    const exact = this.alerts.findIndex((entry) => entry.resourceId === resourceId);
    const fallback = this.alerts.findIndex((entry) => {
      const action = entry.action as Extract<BridgeAction, { action: 'addAlert' }>;
      return action.price === price && (action.options?.direction ?? 'cross') === direction;
    });
    const index = exact >= 0 ? exact : fallback;
    if (index >= 0) this.alerts.splice(index, 1);
  }

  removeIndicator(resourceId: string, indicatorType: string, params: number[] = []): void {
    const exact = this.indicators.findIndex((entry) => entry.resourceId === resourceId);
    const key = `${indicatorType.toLowerCase()}:${params.join(',')}`;
    const fallback = this.indicators.findIndex((entry) =>
      indicatorKey(entry.action as Extract<BridgeAction, { action: 'addIndicator' }>) === key,
    );
    const index = exact >= 0 ? exact : fallback;
    if (index >= 0) this.indicators.splice(index, 1);
  }

  bindResourceId(action: BridgeAction, resourceId: string): void {
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
    const entry = entries.find(match);
    if (entry) entry.resourceId = resourceId;
  }

  bindResourceIds(action: BridgeAction, resourceIds: readonly string[]): void {
    if (action.action !== 'replaceAgentDrawingGroup') return;
    const entry = this.drawingGroups.find((candidate) =>
      candidate.action.action === 'replaceAgentDrawingGroup'
      && candidate.action.groupId === action.groupId
      && candidate.action.idempotencyKey === action.idempotencyKey
    );
    if (entry) entry.resourceIds = [...resourceIds];
  }

  /** Reset everything. Used by tests. */
  clear(): void {
    this.indicators = [];
    this.drawings = [];
    this.drawingGroups = [];
    this.alerts = [];
  }
}

export const chartState = new ChartStateJournal();
