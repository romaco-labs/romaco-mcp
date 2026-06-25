import { describe, it, expect, afterEach } from 'vitest';
import { WebSocket } from 'ws';
import { RomacoBridge } from '../src/bridge.js';
import type { BridgeAction } from '../src/types.js';

let portSeed = 14500;
const nextPort = () => portSeed++;

function closeBridge(bridge: RomacoBridge) {
  bridge.close();
}

/**
 * Creates a bridge + connected mock browser client.
 * The client auto-replies with success to all messages.
 * Returns the bridge and a function to intercept the next outbound action.
 */
async function setup() {
  const port = nextPort();
  const bridge = new RomacoBridge(port);
  await bridge.start();

  const ws = new WebSocket(`ws://localhost:${port}`);
  await new Promise<void>(r => ws.once('open', r));
  // Real McpBridge sends 'ready' on open; the bridge only adopts the client
  // then (StrictMode zombie guard). The 30ms settle below covers adoption.
  ws.send(JSON.stringify({ type: 'ready', chartId: 'test' }));

  const sentActions: BridgeAction[] = [];
  let sentMsg: Record<string, unknown> | null = null;

  ws.on('message', (raw) => {
    const msg = JSON.parse(raw.toString()) as Record<string, unknown>;
    if (msg.type === 'execute_action') {
      sentActions.push(msg.action as BridgeAction);
      sentMsg = msg;
      ws.send(JSON.stringify({ type: 'action_result', requestId: msg.requestId, result: { success: true } }));
    }
    if (msg.type === 'get_context') {
      sentMsg = msg;
      ws.send(JSON.stringify({ type: 'context_result', requestId: msg.requestId, context: { visibleCandles: [{ open: 100 }] } }));
    }
    if (msg.type === 'capture_snapshot') {
      sentMsg = msg;
      ws.send(JSON.stringify({ type: 'snapshot_result', requestId: msg.requestId, dataUrl: 'data:image/png;base64,abc=' }));
    }
  });

  await new Promise(r => setTimeout(r, 30));

  return {
    bridge,
    sentActions,
    getSentMsg: () => sentMsg,
    teardown: async () => {
      ws.close();
      closeBridge(bridge);
      await new Promise(r => setTimeout(r, 30));
    },
  };
}

describe('Bridge action shapes', () => {
  const teardowns: Array<() => Promise<void>> = [];

  afterEach(async () => {
    for (const fn of teardowns) await fn();
    teardowns.length = 0;
  });

  describe('romaco_add_indicator', () => {
    it('sends indicatorType and params', async () => {
      const { bridge, sentActions, teardown } = await setup();
      teardowns.push(teardown);

      await bridge.executeAction({ action: 'addIndicator', indicatorType: 'EMA', params: [20] });

      expect(sentActions[0]).toMatchObject({ action: 'addIndicator', indicatorType: 'EMA', params: [20] });
    });

    it('omits params when not provided', async () => {
      const { bridge, sentActions, teardown } = await setup();
      teardowns.push(teardown);

      await bridge.executeAction({ action: 'addIndicator', indicatorType: 'RSI' });

      expect(sentActions[0].action).toBe('addIndicator');
      expect((sentActions[0] as { params?: unknown }).params).toBeUndefined();
    });

    it('supports MACD with 3 params', async () => {
      const { bridge, sentActions, teardown } = await setup();
      teardowns.push(teardown);

      await bridge.executeAction({ action: 'addIndicator', indicatorType: 'MACD', params: [12, 26, 9] });

      expect(sentActions[0]).toMatchObject({ indicatorType: 'MACD', params: [12, 26, 9] });
    });
  });

  describe('romaco_add_drawing', () => {
    it('sends drawingType, points, and label', async () => {
      const { bridge, sentActions, teardown } = await setup();
      teardowns.push(teardown);

      const points = [{ timestamp: 1000, price: 100 }, { timestamp: 2000, price: 120 }];
      await bridge.executeAction({ action: 'addDrawing', drawingType: 'trendline', points, label: 'Support' });

      expect(sentActions[0]).toMatchObject({ action: 'addDrawing', drawingType: 'trendline', points, label: 'Support' });
    });

    it('sends horizontalLine with single point', async () => {
      const { bridge, sentActions, teardown } = await setup();
      teardowns.push(teardown);

      await bridge.executeAction({ action: 'addDrawing', drawingType: 'horizontalLine', points: [{ timestamp: 0, price: 150 }] });

      expect(sentActions[0]).toMatchObject({ drawingType: 'horizontalLine', points: [{ price: 150 }] });
    });

    it('omits label when not provided', async () => {
      const { bridge, sentActions, teardown } = await setup();
      teardowns.push(teardown);

      await bridge.executeAction({ action: 'addDrawing', drawingType: 'rectangle', points: [{ timestamp: 1, price: 10 }, { timestamp: 2, price: 20 }] });

      expect((sentActions[0] as { label?: unknown }).label).toBeUndefined();
    });
  });

  describe('romaco_set_zoom / romaco_reset_view', () => {
    it('sends zoomIn with factor', async () => {
      const { bridge, sentActions, teardown } = await setup();
      teardowns.push(teardown);

      await bridge.executeAction({ action: 'zoomIn', factor: 1.5 });

      expect(sentActions[0]).toMatchObject({ action: 'zoomIn', factor: 1.5 });
    });

    it('sends zoomOut without factor', async () => {
      const { bridge, sentActions, teardown } = await setup();
      teardowns.push(teardown);

      await bridge.executeAction({ action: 'zoomOut' });

      expect(sentActions[0].action).toBe('zoomOut');
      expect((sentActions[0] as { factor?: unknown }).factor).toBeUndefined();
    });

    it('sends resetView with no extra fields', async () => {
      const { bridge, sentActions, teardown } = await setup();
      teardowns.push(teardown);

      await bridge.executeAction({ action: 'resetView' });

      expect(sentActions[0]).toEqual({ action: 'resetView' });
    });
  });

  describe('romaco_add_alert', () => {
    it('sends price, direction, and note', async () => {
      const { bridge, sentActions, teardown } = await setup();
      teardowns.push(teardown);

      await bridge.executeAction({ action: 'addAlert', price: 150.5, options: { direction: 'above', note: 'Key resistance' } });

      expect(sentActions[0]).toMatchObject({
        action: 'addAlert',
        price: 150.5,
        options: { direction: 'above', note: 'Key resistance' },
      });
    });

    it('sends minimal alert with only price', async () => {
      const { bridge, sentActions, teardown } = await setup();
      teardowns.push(teardown);

      await bridge.executeAction({ action: 'addAlert', price: 200 });

      expect(sentActions[0]).toMatchObject({ action: 'addAlert', price: 200 });
      expect((sentActions[0] as { options?: unknown }).options).toBeUndefined();
    });

    it('accepts all three direction values', async () => {
      const { bridge, sentActions, teardown } = await setup();
      teardowns.push(teardown);

      for (const direction of ['above', 'below', 'cross'] as const) {
        await bridge.executeAction({ action: 'addAlert', price: 100, options: { direction } });
      }

      expect(sentActions.map(a => (a as { options: { direction: string } }).options.direction)).toEqual(['above', 'below', 'cross']);
    });
  });

  describe('romaco_clear_drawings', () => {
    it('sends clearDrawings with no extra fields', async () => {
      const { bridge, sentActions, teardown } = await setup();
      teardowns.push(teardown);

      await bridge.executeAction({ action: 'clearDrawings' });

      expect(sentActions[0]).toEqual({ action: 'clearDrawings' });
    });
  });

  describe('romaco_open_paper_position', () => {
    it('sends openPaperLong with all fields', async () => {
      const { bridge, sentActions, teardown } = await setup();
      teardowns.push(teardown);

      await bridge.executeAction({ action: 'openPaperLong', quantity: 10, stopLoss: 90, takeProfit: 120 });

      expect(sentActions[0]).toMatchObject({ action: 'openPaperLong', quantity: 10, stopLoss: 90, takeProfit: 120 });
    });

    it('sends openPaperShort with quantity only', async () => {
      const { bridge, sentActions, teardown } = await setup();
      teardowns.push(teardown);

      await bridge.executeAction({ action: 'openPaperShort', quantity: 5 });

      expect(sentActions[0]).toMatchObject({ action: 'openPaperShort', quantity: 5 });
      expect((sentActions[0] as { stopLoss?: unknown }).stopLoss).toBeUndefined();
    });
  });

  describe('romaco_get_visible_candles', () => {
    it('sends get_context and returns visibleCandles', async () => {
      const { bridge, getSentMsg, teardown } = await setup();
      teardowns.push(teardown);

      await bridge.getContext(true);

      expect(getSentMsg()?.type).toBe('get_context');
      expect(getSentMsg()?.includeCandles).toBe(true);
    });
  });

  describe('romaco_capture_snapshot', () => {
    it('sends capture_snapshot with png format', async () => {
      const { bridge, getSentMsg, teardown } = await setup();
      teardowns.push(teardown);

      await bridge.captureSnapshot('png');

      expect(getSentMsg()?.type).toBe('capture_snapshot');
      expect(getSentMsg()?.format).toBe('png');
    });

    it('sends capture_snapshot with jpeg format', async () => {
      const { bridge, getSentMsg, teardown } = await setup();
      teardowns.push(teardown);

      await bridge.captureSnapshot('jpeg');

      expect(getSentMsg()?.format).toBe('jpeg');
    });
  });
});
