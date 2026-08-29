import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { registerAddIndicator } from '../../src/adapters/inbound/mcp/tools/addIndicator.js';
import type { ChartPort } from '../../src/application/ports/chart.js';
import { ReconcileChartStateUseCase } from '../../src/application/use-cases/reconcileChartState.js';
import { LegacyChartJournal } from '../../src/bootstrap/LegacyChartJournal.js';
import { ChartStateJournal } from '../../src/chartState.js';
import type {
  ChartAlertState,
  ChartCommand,
  ChartCommandResult,
  ChartIdentity,
  ChartIndicatorState,
  ReplaceDrawingGroupCommand,
} from '../../src/domain/chart/model.js';
import { createChartId } from '../../src/domain/chart/model.js';
import { registerAddAlert } from '../../src/tools/add_alert.js';
import { registerRemoveAlert } from '../../src/tools/remove_alert.js';
import { registerRemoveIndicator } from '../../src/tools/remove_indicator.js';

const AAPL: ChartIdentity = {
  chartId: createChartId('chart-a'), symbol: 'AAPL', timeframe: '1d',
};
const TSLA: ChartIdentity = {
  chartId: createChartId('chart-b'), symbol: 'TSLA', timeframe: '1d',
};

function structured(result: Awaited<ReturnType<Client['callTool']>>): any {
  return result.structuredContent;
}

class FakeChart implements ChartPort {
  readonly writes: ChartCommand[] = [];
  readonly groupWrites: ReplaceDrawingGroupCommand[] = [];
  indicators: ChartIndicatorState[] = [];
  alerts: ChartAlertState[] = [];
  private nextId = 0;

  constructor(public identity: ChartIdentity) {}

  isConnected(): boolean { return true; }

  async getIdentity(): Promise<ChartIdentity> { return this.identity; }

  async getContext() {
    return {
      identity: this.identity,
      totalCandles: 300,
      indicators: structuredClone(this.indicators),
      drawings: [],
      alerts: structuredClone(this.alerts),
    };
  }

  async execute(command: ChartCommand): Promise<ChartCommandResult> {
    this.writes.push(structuredClone(command));
    if (command.action === 'addIndicator') {
      const id = `indicator-${++this.nextId}`;
      this.indicators.push({ id, type: command.indicatorType, params: command.params ?? [] });
      return { success: true, resourceIds: [id] };
    }
    if (command.action === 'removeIndicator') {
      this.indicators = this.indicators.filter((entry) => entry.id !== command.indicatorId);
      return { success: true };
    }
    if (command.action === 'addAlert') {
      const id = `alert-${++this.nextId}`;
      this.alerts.push({
        id,
        price: command.price,
        direction: command.options?.direction ?? 'cross',
      });
      return { success: true, resourceIds: [id] };
    }
    if (command.action === 'removeAlert') {
      this.alerts = this.alerts.filter((entry) => entry.id !== command.alertId);
      return { success: true };
    }
    return { success: true };
  }

  async replaceDrawingGroup(command: ReplaceDrawingGroupCommand): Promise<ChartCommandResult> {
    this.groupWrites.push(structuredClone(command));
    return { success: true, resourceIds: ['group-drawing-1'] };
  }

  async captureSnapshot(format: 'png' | 'jpeg') {
    return { format, dataUrl: `data:image/${format};base64,eA==` };
  }
}

describe('injected reconnect desired-state workflow', () => {
  let server: McpServer;
  let client: Client;

  beforeEach(() => {
    server = new McpServer({ name: 'reconnect-test', version: '0.0.0' });
  });

  afterEach(async () => {
    await client?.close();
    await server.close();
  });

  async function connect(chart: FakeChart, journal: LegacyChartJournal): Promise<void> {
    registerAddIndicator(server, chart, journal);
    registerAddAlert(server, chart, journal);
    registerRemoveIndicator(server, chart, journal);
    registerRemoveAlert(server, chart, journal);
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await server.connect(serverTransport);
    client = new Client({ name: 'test', version: '0.0.0' }, { capabilities: {} });
    await client.connect(clientTransport);
  }

  it('keeps removed indicator and alert absent after same-chart reconnect', async () => {
    const chart = new FakeChart(AAPL);
    const journal = new LegacyChartJournal(new ChartStateJournal());
    await connect(chart, journal);

    const addedIndicator = await client.callTool({
      name: 'romaco_add_indicator', arguments: { indicatorType: 'RSI', params: [14] },
    });
    const indicatorId = structured(addedIndicator).data.indicator.indicatorId;
    const addedAlert = await client.callTool({
      name: 'romaco_add_alert', arguments: { price: 150, direction: 'above' },
    });
    const alertId = structured(addedAlert).data.alert.alertId;
    const removedIndicator = await client.callTool({
      name: 'romaco_remove_indicator', arguments: { indicatorId },
    });
    const removedAlert = await client.callTool({
      name: 'romaco_remove_alert', arguments: { alertId },
    });
    expect(structured(removedIndicator)).toMatchObject({
      status: 'ok', data: { indicatorId, type: 'RSI', removed: true },
    });
    expect(structured(removedAlert)).toMatchObject({
      status: 'ok', data: { alertId, price: 150, direction: 'above', removed: true },
    });
    const writesBeforeReconnect = chart.writes.length;

    const result = await new ReconcileChartStateUseCase(chart, journal).execute();

    expect(result.status).toBe('empty');
    expect(chart.writes).toHaveLength(writesBeforeReconnect);
    expect(journal.snapshot()).toEqual({
      indicators: [], drawings: [], drawingGroups: [], alerts: [],
    });
  });

  it('keeps AAPL drawings and alerts attributable but writes nothing onto TSLA reconnect', async () => {
    const journal = new LegacyChartJournal(new ChartStateJournal());
    journal.recordDrawing({
      action: 'addDrawing',
      drawingType: 'horizontalLine',
      points: [{ timestamp: 1, price: 150 }],
    }, AAPL, 'aapl-line');
    journal.recordAlert(
      { action: 'addAlert', price: 150, options: { direction: 'above' } },
      AAPL,
      'aapl-alert',
    );
    const chart = new FakeChart(TSLA);

    const result = await new ReconcileChartStateUseCase(chart, journal).execute();

    expect(result).toMatchObject({ status: 'reconciled', applied: 0, skippedIdentity: 2 });
    expect(chart.writes).toEqual([]);
    expect(journal.snapshot().drawings[0].identity).toEqual(AAPL);
    expect(journal.snapshot().alerts[0].identity).toEqual(AAPL);
  });
});
