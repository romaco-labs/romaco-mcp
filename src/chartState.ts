import type { BridgeAction } from './types.js';

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
}

export interface JournalSnapshot {
  indicators: JournalEntry[];
  drawings: JournalEntry[];
  alerts: JournalEntry[];
}

/** Stable identity for an addIndicator action: type (case-insensitive) + params. */
function indicatorKey(a: Extract<BridgeAction, { action: 'addIndicator' }>): string {
  return `${a.indicatorType.toLowerCase()}:${(a.params ?? []).join(',')}`;
}

class ChartStateJournal {
  private indicators: JournalEntry[] = [];
  private drawings: JournalEntry[] = [];
  private alerts: JournalEntry[] = [];

  /** Record an applied indicator. Deduped by type+params so replays never stack. */
  recordIndicator(action: Extract<BridgeAction, { action: 'addIndicator' }>, symbol: string | null): void {
    const key = indicatorKey(action);
    const existing = this.indicators.findIndex(
      (e) => indicatorKey(e.action as Extract<BridgeAction, { action: 'addIndicator' }>) === key,
    );
    if (existing !== -1) {
      // Refresh the symbol so the most-recent context wins; indicators replay
      // regardless of symbol, so this is mostly bookkeeping.
      this.indicators[existing] = { action, symbol };
      return;
    }
    this.indicators.push({ action, symbol });
  }

  recordDrawing(action: Extract<BridgeAction, { action: 'addDrawing' }>, symbol: string | null): void {
    this.drawings.push({ action, symbol });
  }

  recordAlert(action: Extract<BridgeAction, { action: 'addAlert' }>, symbol: string | null): void {
    this.alerts.push({ action, symbol });
  }

  /** Mirror the clearDrawings bridge action so reconcile won't re-add them. */
  clearDrawings(): void {
    this.drawings = [];
  }

  /** Drop journaled drawings in a group so reconcile won't replay a replaced set. */
  removeDrawingsByGroup(groupId: string): void {
    this.drawings = this.drawings.filter(
      (e) => (e.action as Extract<BridgeAction, { action: 'addDrawing' }>).groupId !== groupId,
    );
  }

  /** Immutable view of the desired state, for the reconciler. */
  snapshot(): JournalSnapshot {
    return {
      indicators: [...this.indicators],
      drawings: [...this.drawings],
      alerts: [...this.alerts],
    };
  }

  clearAlerts(): void {
    this.alerts = [];
  }

  removeAlert(price: number, direction: string): void {
    this.alerts = this.alerts.filter((e) => {
      const a = e.action as { price?: number; direction?: string };
      return !(a.price === price && a.direction === direction);
    });
  }

  removeIndicator(indicatorType: string): void {
    const key = indicatorType.toLowerCase();
    this.indicators = this.indicators.filter(
      (e) => (e.action as Extract<BridgeAction, { action: 'addIndicator' }>).indicatorType.toLowerCase() !== key,
    );
  }

  /** Reset everything. Used by tests. */
  clear(): void {
    this.indicators = [];
    this.drawings = [];
    this.alerts = [];
  }
}

export const chartState = new ChartStateJournal();
