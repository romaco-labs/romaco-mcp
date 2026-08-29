import { describe, expect, it } from 'vitest';
import { LegacyChartJournal } from '../../src/bootstrap/LegacyChartJournal.js';
import { ChartStateJournal } from '../../src/chartState.js';
import { createChartId } from '../../src/domain/chart/model.js';

const AAPL = {
  chartId: createChartId('chart-a'), symbol: 'AAPL', timeframe: '1d' as const,
};
const TSLA = {
  chartId: createChartId('chart-b'), symbol: 'TSLA', timeframe: '1d' as const,
};

describe('LegacyChartJournal desired-state adapter', () => {
  it('keeps identical indicators attributable to separate exact chart identities', () => {
    const journal = new LegacyChartJournal(new ChartStateJournal());

    journal.recordIndicator({ type: 'RSI', params: [14] }, AAPL, 'rsi-aapl');
    journal.recordIndicator({ type: 'RSI', params: [14] }, TSLA, 'rsi-tsla');

    expect(journal.snapshot().indicators).toEqual([
      {
        command: { action: 'addIndicator', indicatorType: 'RSI', params: [14] },
        identity: AAPL,
        resourceIds: ['rsi-aapl'],
      },
      {
        command: { action: 'addIndicator', indicatorType: 'RSI', params: [14] },
        identity: TSLA,
        resourceIds: ['rsi-tsla'],
      },
    ]);
  });

  it('removes exact host indicator and alert resources from desired state', () => {
    const journal = new LegacyChartJournal(new ChartStateJournal());
    journal.recordIndicator({ type: 'RSI', params: [14] }, AAPL, 'rsi-aapl');
    journal.recordAlert(
      { action: 'addAlert', price: 150, options: { direction: 'above' } },
      AAPL,
      'alert-aapl',
    );

    journal.removeIndicator('rsi-aapl', 'RSI', [14]);
    journal.removeAlert('alert-aapl', 150, 'above');

    expect(journal.snapshot()).toEqual({
      indicators: [], drawings: [], drawingGroups: [], alerts: [],
    });
  });

  it('replaces a drawing group only within its exact identity scope', () => {
    const state = new ChartStateJournal();
    const journal = new LegacyChartJournal(state);
    const drawing = {
      action: 'addDrawing' as const,
      drawingType: 'horizontalLine',
      points: [{ timestamp: 1, price: 100 }],
    };

    journal.replaceDrawingGroup('romaco-mcp/thesis', [drawing], AAPL, 'aapl-v1');
    journal.replaceDrawingGroup('romaco-mcp/thesis', [drawing], TSLA, 'tsla-v1');
    journal.replaceDrawingGroup('romaco-mcp/thesis', [drawing], AAPL, 'aapl-v2');

    const groups = journal.snapshot().drawingGroups;
    expect(groups).toHaveLength(2);
    expect(groups.map((entry) => [entry.identity.symbol, entry.command.idempotencyKey])).toEqual([
      ['TSLA', 'tsla-v1'],
      ['AAPL', 'aapl-v2'],
    ]);
  });

  it('fails closed by hiding unattributed legacy entries from reconciliation', () => {
    const state = new ChartStateJournal();
    state.recordIndicator(
      { action: 'addIndicator', indicatorType: 'RSI', params: [14] },
      'AAPL',
      'legacy-rsi',
    );

    expect(new LegacyChartJournal(state).snapshot().indicators).toEqual([]);
  });
});
