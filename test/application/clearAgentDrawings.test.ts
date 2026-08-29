import { describe, expect, it, vi } from 'vitest';
import { ClearAgentDrawingsUseCase } from '../../src/application/use-cases/clearAgentDrawings.js';
import type { AgentDrawingJournalPort } from '../../src/application/ports/agentDrawingJournal.js';
import type { ChartPort } from '../../src/application/ports/chart.js';
import { createChartId } from '../../src/domain/chart/model.js';

const identity = { chartId: createChartId('primary'), symbol: 'AAPL', timeframe: '1d' as const };

function fixture() {
  const groups = new Map([
    ['romaco-mcp/thesis', 3],
    ['romaco-mcp/pattern/flag', 2],
    ['user/group', 9],
  ]);
  const chart: ChartPort = {
    isConnected: () => true,
    getIdentity: vi.fn(async () => identity),
    getContext: vi.fn(),
    execute: vi.fn(),
    replaceDrawingGroup: vi.fn(async () => ({ success: true })),
    captureSnapshot: vi.fn(),
  };
  const journal: AgentDrawingJournalPort = {
    listAgentDrawingGroups: vi.fn(() => [...groups].map(([groupId, drawingCount]) => ({ groupId, drawingCount }))),
    removeAgentDrawingGroup: vi.fn((groupId) => { groups.delete(groupId); }),
  };
  return { chart, journal, groups, useCase: new ClearAgentDrawingsUseCase(chart, journal) };
}

describe('ClearAgentDrawingsUseCase', () => {
  it('previews exact identity and reserved groups without chart writes', async () => {
    const context = fixture();
    const plan = await context.useCase.preview();

    expect(plan.identity).toEqual(identity);
    expect(plan.groups).toEqual([
      { groupId: 'romaco-mcp/pattern/flag', drawingCount: 2 },
      { groupId: 'romaco-mcp/thesis', drawingCount: 3 },
    ]);
    expect(plan.drawingCount).toBe(5);
    expect(context.chart.replaceDrawingGroup).not.toHaveBeenCalled();
    expect(context.groups.has('user/group')).toBe(true);
  });

  it('applies approved plan as empty agent-group replacements and preserves user groups', async () => {
    const context = fixture();
    const plan = await context.useCase.preview();
    const result = await context.useCase.apply(plan);

    expect(result.removedCount).toBe(5);
    expect(result.removedGroupIds).toEqual(['romaco-mcp/pattern/flag', 'romaco-mcp/thesis']);
    expect(context.chart.replaceDrawingGroup).toHaveBeenCalledTimes(2);
    for (const [command] of vi.mocked(context.chart.replaceDrawingGroup).mock.calls) {
      expect(command.drawings).toEqual([]);
      expect(command.expectedIdentity).toEqual(identity);
      expect(command.groupId).toMatch(/^romaco-mcp\//);
    }
    expect(context.groups.has('user/group')).toBe(true);
  });

  it('rejects stale plan before any write', async () => {
    const context = fixture();
    const plan = await context.useCase.preview();
    context.groups.set('romaco-mcp/new', 1);

    await expect(context.useCase.apply(plan)).rejects.toMatchObject({ code: 'CHART_CONTEXT_MISMATCH' });
    expect(context.chart.replaceDrawingGroup).not.toHaveBeenCalled();
  });

  it('reports partial apply and journals only successful groups', async () => {
    const context = fixture();
    vi.mocked(context.chart.replaceDrawingGroup)
      .mockResolvedValueOnce({ success: true })
      .mockRejectedValueOnce(new Error('host denied'));
    const plan = await context.useCase.preview();

    await expect(context.useCase.apply(plan)).rejects.toMatchObject({
      code: 'PARTIAL_APPLY',
      details: {
        appliedGroupIds: ['romaco-mcp/pattern/flag'],
        failedGroupId: 'romaco-mcp/thesis',
      },
    });
    expect(context.groups.has('romaco-mcp/pattern/flag')).toBe(false);
    expect(context.groups.has('romaco-mcp/thesis')).toBe(true);
  });
});

