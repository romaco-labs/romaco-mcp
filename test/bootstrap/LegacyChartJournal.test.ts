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
      expect.objectContaining({
        command: { action: 'addIndicator', indicatorType: 'RSI', params: [14] },
        identity: AAPL,
        resourceIds: ['rsi-aapl'],
      }),
      expect.objectContaining({
        command: { action: 'addIndicator', indicatorType: 'RSI', params: [14] },
        identity: TSLA,
        resourceIds: ['rsi-tsla'],
      }),
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

    journal.removeIndicator(AAPL, 'rsi-aapl', 'RSI', [14]);
    journal.removeAlert(AAPL, 'alert-aapl', 150, 'above');

    expect(journal.snapshot()).toEqual({
      indicators: [], drawings: [], drawingGroups: [], alerts: [],
    });
  });

  it('scopes exact-id and semantic-fallback removals to full identity', () => {
    const journal = new LegacyChartJournal(new ChartStateJournal());
    journal.recordIndicator({ type: 'RSI', params: [14] }, AAPL, 'shared-rsi');
    journal.recordIndicator({ type: 'RSI', params: [14] }, TSLA, 'shared-rsi');
    journal.recordIndicator({ type: 'EMA', params: [20] }, AAPL, 'aapl-ema');
    journal.recordIndicator({ type: 'EMA', params: [20] }, TSLA, 'tsla-ema');
    journal.recordAlert(
      { action: 'addAlert', price: 150, options: { direction: 'above' } },
      AAPL,
      'shared-alert',
    );
    journal.recordAlert(
      { action: 'addAlert', price: 150, options: { direction: 'above' } },
      TSLA,
      'shared-alert',
    );

    journal.removeIndicator(AAPL, 'shared-rsi', 'RSI', [14]);
    journal.removeIndicator(AAPL, 'missing-id', 'EMA', [20]);
    journal.removeAlert(AAPL, 'shared-alert', 150, 'above');

    const snapshot = journal.snapshot();
    expect(snapshot.indicators.map((entry) => [entry.identity, entry.command.indicatorType]))
      .toEqual([[TSLA, 'RSI'], [TSLA, 'EMA']]);
    expect(snapshot.alerts).toHaveLength(1);
    expect(snapshot.alerts[0].identity).toEqual(TSLA);
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
    expect(groups.map((entry) => [entry.identity.symbol, entry.command.idempotencyKey])).toEqual(
      expect.arrayContaining([['TSLA', 'tsla-v1'], ['AAPL', 'aapl-v2']]),
    );
    const aapl = groups.find((entry) => entry.identity.symbol === 'AAPL')!;
    expect(aapl.entryVersion).toBe(2);
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
