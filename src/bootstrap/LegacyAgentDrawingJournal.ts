import type {
  AgentDrawingGroupSummary,
  AgentDrawingJournalPort,
} from '../application/ports/agentDrawingJournal.js';
import type { ChartIdentity } from '../domain/chart/model.js';
import type { BridgeAction } from '../types.js';
import { chartState, type JournalEntry } from '../chartState.js';

const AGENT_GROUP_PREFIX = 'romaco-mcp/';

function sameIdentity(entry: JournalEntry, identity: ChartIdentity): boolean {
  return entry.identity?.chartId === identity.chartId
    && entry.identity.symbol === identity.symbol
    && entry.identity.timeframe === identity.timeframe
    && entry.identity.datasetId === identity.datasetId;
}

/** Compatibility adapter from legacy desired-state journal to application port. */
export class LegacyAgentDrawingJournal implements AgentDrawingJournalPort {
  listAgentDrawingGroups(identity: ChartIdentity): readonly AgentDrawingGroupSummary[] {
    const counts = new Map<string, number>();
    const snapshot = chartState.snapshot();
    for (const entry of snapshot.drawingGroups) {
      if (!sameIdentity(entry, identity)) continue;
      const action = entry.action as Extract<BridgeAction, { action: 'replaceAgentDrawingGroup' }>;
      if (!action.groupId.startsWith(AGENT_GROUP_PREFIX)) continue;
      counts.set(action.groupId, action.drawings.length);
    }
    for (const entry of snapshot.drawings) {
      if (!sameIdentity(entry, identity)) continue;
      const action = entry.action as Extract<BridgeAction, { action: 'addDrawing' }>;
      const groupId = action.groupId;
      if (!groupId?.startsWith(AGENT_GROUP_PREFIX)) continue;
      counts.set(groupId, (counts.get(groupId) ?? 0) + 1);
    }
    return [...counts].map(([groupId, drawingCount]) => ({ groupId, drawingCount }));
  }

  removeAgentDrawingGroup(groupId: string, identity: ChartIdentity): void {
    if (!groupId.startsWith(AGENT_GROUP_PREFIX)) {
      throw new Error(`Refusing to remove non-agent drawing group ${groupId}.`);
    }
    const existing = this.listAgentDrawingGroups(identity).some((group) => group.groupId === groupId);
    if (existing) chartState.removeDrawingsByGroupForIdentity(groupId, identity);
  }
}
