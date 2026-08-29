import { ApplicationError } from '../errors.js';
import type { AgentDrawingGroupSummary, AgentDrawingJournalPort } from '../ports/agentDrawingJournal.js';
import type { ChartPort } from '../ports/chart.js';
import type { ChartIdentity } from '../../domain/chart/model.js';

const AGENT_GROUP_PREFIX = 'romaco-mcp/';

export interface ClearAgentDrawingsPlan {
  planId: string;
  identity: ChartIdentity & { symbol: string; timeframe: NonNullable<ChartIdentity['timeframe']> };
  groups: readonly AgentDrawingGroupSummary[];
  drawingCount: number;
}

export interface ClearAgentDrawingsResult extends ClearAgentDrawingsPlan {
  removedGroupIds: readonly string[];
  removedCount: number;
}

function exactIdentity(identity: ChartIdentity): ClearAgentDrawingsPlan['identity'] {
  if (!identity.symbol || !identity.timeframe) {
    throw new ApplicationError(
      'CHART_NOT_READY',
      'Clearing agent drawings requires exact chartId, symbol, and timeframe identity.',
      {
        retryable: true,
        recovery: {
          action: 'connect_chart',
          instruction: 'Load a symbol and timeframe in the paired chart, then retry.',
        },
      },
    );
  }
  return { ...identity, symbol: identity.symbol, timeframe: identity.timeframe };
}

function part(value: string | number | undefined): string {
  const text = value === undefined ? '' : String(value);
  return `${text.length}:${text}`;
}

function planIdentity(
  identity: ClearAgentDrawingsPlan['identity'],
  groups: readonly AgentDrawingGroupSummary[],
): string {
  return [
    'clear-agent-drawings-v1',
    part(identity.chartId),
    part(identity.symbol),
    part(identity.timeframe),
    part(identity.datasetId),
    ...groups.flatMap((group) => [part(group.groupId), part(group.drawingCount)]),
  ].join('|');
}

export class ClearAgentDrawingsUseCase {
  constructor(
    private readonly chart: ChartPort,
    private readonly journal: AgentDrawingJournalPort,
  ) {}

  async preview(): Promise<ClearAgentDrawingsPlan> {
    const identity = exactIdentity(await this.chart.getIdentity());
    const groups = this.journal.listAgentDrawingGroups(identity)
      .filter((group) => group.groupId.startsWith(AGENT_GROUP_PREFIX))
      .map((group) => ({ ...group }))
      .sort((left, right) => left.groupId.localeCompare(right.groupId));
    const drawingCount = groups.reduce((sum, group) => sum + group.drawingCount, 0);
    return {
      planId: planIdentity(identity, groups),
      identity,
      groups,
      drawingCount,
    };
  }

  async apply(approvedPlan: ClearAgentDrawingsPlan): Promise<ClearAgentDrawingsResult> {
    const current = await this.preview();
    if (current.planId !== approvedPlan.planId) {
      throw new ApplicationError('CHART_CONTEXT_MISMATCH', 'Approved drawing-clear plan is stale.', {
        recovery: {
          action: 'request_approval',
          instruction: 'Preview current Romaco drawing groups and request a new approval token.',
        },
      });
    }

    const removedGroupIds: string[] = [];
    let removedCount = 0;
    for (const group of current.groups) {
      try {
        const result = await this.chart.replaceDrawingGroup({
          groupId: group.groupId,
          drawings: [],
          expectedIdentity: current.identity,
          idempotencyKey: `${current.planId}|clear|${part(group.groupId)}`,
        });
        if (!result.success) throw new Error(result.error ?? 'Chart rejected drawing-group removal.');
        this.journal.removeAgentDrawingGroup(group.groupId, current.identity);
        removedGroupIds.push(group.groupId);
        removedCount += group.drawingCount;
      } catch (cause) {
        if (removedGroupIds.length > 0) {
          throw new ApplicationError('PARTIAL_APPLY', 'Only part of approved drawing-clear plan applied.', {
            retryable: true,
            recovery: {
              action: 'retry',
              instruction: 'Request a fresh preview; already removed groups remain removed.',
            },
            details: {
              planId: current.planId,
              appliedGroupIds: removedGroupIds,
              failedGroupId: group.groupId,
            },
            cause,
          });
        }
        throw new ApplicationError('ACTION_DENIED', 'Chart rejected approved agent drawing removal.', {
          retryable: true,
          recovery: {
            action: 'retry',
            instruction: 'Verify paired chart identity and host write policy, then request new approval.',
          },
          details: { planId: current.planId, failedGroupId: group.groupId },
          cause,
        });
      }
    }

    return {
      ...current,
      removedGroupIds,
      removedCount,
    };
  }
}

