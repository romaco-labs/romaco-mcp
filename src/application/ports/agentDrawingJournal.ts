import type { ChartIdentity } from '../../domain/chart/model.js';

export interface AgentDrawingGroupSummary {
  groupId: string;
  drawingCount: number;
}

/** Desired-state access limited to Romaco-owned drawing groups. */
export interface AgentDrawingJournalPort {
  listAgentDrawingGroups(identity: ChartIdentity): readonly AgentDrawingGroupSummary[];
  removeAgentDrawingGroup(groupId: string, identity: ChartIdentity): void;
}
