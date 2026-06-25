import { describe, it, expect, afterEach } from 'vitest';
import { WebSocket } from 'ws';
import { RomacoBridge } from '../src/bridge.js';

let portSeed = 14200;
const nextPort = () => portSeed++;

async function startBridge(port: number) {
  const bridge = new RomacoBridge(port);
  await bridge.start();
  return bridge;
}

async function connectClient(port: number): Promise<WebSocket> {
  const ws = new WebSocket(`ws://localhost:${port}`);
  await new Promise<void>((resolve, reject) => {
    ws.once('open', resolve);
    ws.once('error', reject);
  });
  // Mirror the real McpBridge contract: the browser sends 'ready' on open and
  // the bridge adopts the client only then (StrictMode zombie guard). Wait
  // for the adoption ping so isConnected is true when this resolves.
  const adopted = new Promise<void>((resolve) => {
    const onMsg = (raw: Buffer | string) => {
      try {
        if ((JSON.parse(raw.toString()) as { type?: string }).type === 'ping') {
          ws.off('message', onMsg);
          resolve();
        }
      } catch { /* ignore */ }
    };
    ws.on('message', onMsg);
  });
  ws.send(JSON.stringify({ type: 'ready', chartId: 'test' }));
  await adopted;
  return ws;
}

function autoReply(ws: WebSocket) {
  ws.on('message', (raw) => {
    const msg = JSON.parse(raw.toString()) as Record<string, unknown>;
    if (msg.type === 'execute_action') {
      ws.send(JSON.stringify({ type: 'action_result', requestId: msg.requestId, result: { success: true } }));
    }
    if (msg.type === 'get_context') {
      ws.send(JSON.stringify({ type: 'context_result', requestId: msg.requestId, context: { visibleCandles: [] } }));
    }
    if (msg.type === 'capture_snapshot') {
      ws.send(JSON.stringify({ type: 'snapshot_result', requestId: msg.requestId, dataUrl: 'data:image/png;base64,abc' }));
    }
  });
}

function closeBridge(bridge: RomacoBridge) {
  bridge.close();
}

describe('RomacoBridge', () => {
  const bridges: RomacoBridge[] = [];

  afterEach(async () => {
    bridges.forEach(closeBridge);
    bridges.length = 0;
    await new Promise(r => setTimeout(r, 40));
  });

  async function bridge(port = nextPort()) {
    const b = await startBridge(port);
    bridges.push(b);
    return b;
  }

  describe('startup', () => {
    it('starts and exposes a WebSocket server', async () => {
      const b = await bridge();
      expect((b as unknown as { wss: unknown }).wss).toBeTruthy();
    });

    it('isConnected is false before any client connects', async () => {
      const b = await bridge();
      expect(b.isConnected).toBe(false);
    });

    it('isConnected becomes true after browser connects', async () => {
      const port = nextPort();
      const b = await bridge(port);
      const ws = await connectClient(port);
      await new Promise(r => setTimeout(r, 20));

      expect(b.isConnected).toBe(true);
      ws.close();
    });

    it('isConnected returns false after browser disconnects', async () => {
      const port = nextPort();
      const b = await bridge(port);
      const ws = await connectClient(port);
      await new Promise(r => setTimeout(r, 20));
      ws.close();
      await new Promise(r => setTimeout(r, 50));

      expect(b.isConnected).toBe(false);
    });

    it('start() does not reject when the port is already in use (EADDRINUSE is non-fatal)', async () => {
      const port = nextPort();
      const first = await bridge(port); // owns the port
      const second = new RomacoBridge(port);
      bridges.push(second); // afterEach closes it → clears the background rebind timer

      // Must resolve, not throw — the MCP server has to boot with all tools even
      // when a stale server squats the bridge port.
      await expect(second.start()).resolves.toBeUndefined();

      // Second gave up the port (scheduled a background retry); first still owns it.
      expect((second as unknown as { wss: unknown }).wss).toBeNull();
      expect((first as unknown as { wss: unknown }).wss).toBeTruthy();
    });
  });

  describe('executeAction', () => {
    it('rejects immediately when no browser is connected', async () => {
      const b = await bridge();
      await expect(b.executeAction({ action: 'resetView' })).rejects.toThrow(/No chart connected/);
    });

    it('sends execute_action over WebSocket and returns ActionResult', async () => {
      const port = nextPort();
      const b = await bridge(port);
      const ws = await connectClient(port);
      ws.send(JSON.stringify({ type: 'ready', chartId: 'test' }));
      autoReply(ws);
      await new Promise(r => setTimeout(r, 30));

      const result = await b.executeAction({ action: 'addIndicator', indicatorType: 'EMA', params: [20] });

      expect(result.success).toBe(true);
      ws.close();
    });

    it('sends the exact action shape the browser receives', async () => {
      const port = nextPort();
      const b = await bridge(port);
      const ws = await connectClient(port);
      const received: unknown[] = [];

      ws.on('message', (raw) => {
        const msg = JSON.parse(raw.toString()) as Record<string, unknown>;
        if (msg.type === 'execute_action') {
          received.push(msg.action);
          ws.send(JSON.stringify({ type: 'action_result', requestId: msg.requestId, result: { success: true } }));
        }
      });

      await new Promise(r => setTimeout(r, 30));
      await b.executeAction({ action: 'addIndicator', indicatorType: 'RSI', params: [14] });

      expect(received[0]).toMatchObject({ action: 'addIndicator', indicatorType: 'RSI', params: [14] });
      ws.close();
    });

    it('rejects when browser responds with error', async () => {
      const port = nextPort();
      const b = await bridge(port);
      const ws = await connectClient(port);

      ws.on('message', (raw) => {
        const msg = JSON.parse(raw.toString()) as Record<string, unknown>;
        if (msg.type === 'execute_action') {
          ws.send(JSON.stringify({ type: 'error', requestId: msg.requestId, error: 'Chart not ready' }));
        }
      });

      await new Promise(r => setTimeout(r, 30));
      await expect(b.executeAction({ action: 'clearDrawings' })).rejects.toThrow('Chart not ready');
      ws.close();
    });
  });

  describe('getContext', () => {
    it('resolves with chart context from browser', async () => {
      const port = nextPort();
      const b = await bridge(port);
      const ws = await connectClient(port);
      const fakeCtx = { totalCandles: 500, zoomLevel: 1, visibleCandles: [] };

      ws.on('message', (raw) => {
        const msg = JSON.parse(raw.toString()) as Record<string, unknown>;
        if (msg.type === 'get_context') {
          ws.send(JSON.stringify({ type: 'context_result', requestId: msg.requestId, context: fakeCtx }));
        }
      });

      await new Promise(r => setTimeout(r, 30));
      const ctx = await b.getContext(true);

      expect(ctx).toEqual(fakeCtx);
      ws.close();
    });

    it('sends includeCandles: true in message', async () => {
      const port = nextPort();
      const b = await bridge(port);
      const ws = await connectClient(port);
      let capturedMsg: Record<string, unknown> | null = null;

      ws.on('message', (raw) => {
        const msg = JSON.parse(raw.toString()) as Record<string, unknown>;
        if (msg.type === 'get_context') {
          capturedMsg = msg;
          ws.send(JSON.stringify({ type: 'context_result', requestId: msg.requestId, context: {} }));
        }
      });

      await new Promise(r => setTimeout(r, 30));
      await b.getContext(true);

      expect(capturedMsg?.includeCandles).toBe(true);
      ws.close();
    });
  });

  describe('captureSnapshot', () => {
    it('returns the data URL from the browser', async () => {
      const port = nextPort();
      const b = await bridge(port);
      const ws = await connectClient(port);
      const dataUrl = 'data:image/jpeg;base64,/9j/4AAQ';

      ws.on('message', (raw) => {
        const msg = JSON.parse(raw.toString()) as Record<string, unknown>;
        if (msg.type === 'capture_snapshot') {
          ws.send(JSON.stringify({ type: 'snapshot_result', requestId: msg.requestId, dataUrl }));
        }
      });

      await new Promise(r => setTimeout(r, 30));
      const result = await b.captureSnapshot('jpeg');

      expect(result).toBe(dataUrl);
      ws.close();
    });

    it('passes the requested format to the browser', async () => {
      const port = nextPort();
      const b = await bridge(port);
      const ws = await connectClient(port);
      let format: unknown;

      ws.on('message', (raw) => {
        const msg = JSON.parse(raw.toString()) as Record<string, unknown>;
        if (msg.type === 'capture_snapshot') {
          format = msg.format;
          ws.send(JSON.stringify({ type: 'snapshot_result', requestId: msg.requestId, dataUrl: 'data:image/png;base64,abc' }));
        }
      });

      await new Promise(r => setTimeout(r, 30));
      await b.captureSnapshot('png');

      expect(format).toBe('png');
      ws.close();
    });
  });

  describe('concurrency & resilience', () => {
    it('handles multiple concurrent requests with independent requestIds', async () => {
      const port = nextPort();
      const b = await bridge(port);
      const ws = await connectClient(port);
      autoReply(ws);
      await new Promise(r => setTimeout(r, 30));

      const [r1, r2, r3] = await Promise.all([
        b.executeAction({ action: 'clearDrawings' }),
        b.executeAction({ action: 'resetView' }),
        b.executeAction({ action: 'zoomIn', factor: 2 }),
      ]);

      expect(r1.success).toBe(true);
      expect(r2.success).toBe(true);
      expect(r3.success).toBe(true);
      ws.close();
    });

    it('every request generates a unique requestId', async () => {
      const port = nextPort();
      const b = await bridge(port);
      const ws = await connectClient(port);
      const ids: string[] = [];

      ws.on('message', (raw) => {
        const msg = JSON.parse(raw.toString()) as Record<string, unknown>;
        if (msg.type === 'execute_action') {
          ids.push(msg.requestId as string);
          ws.send(JSON.stringify({ type: 'action_result', requestId: msg.requestId, result: { success: true } }));
        }
      });

      await new Promise(r => setTimeout(r, 30));
      await Promise.all([
        b.executeAction({ action: 'clearDrawings' }),
        b.executeAction({ action: 'resetView' }),
      ]);

      expect(ids).toHaveLength(2);
      expect(ids[0]).not.toBe(ids[1]);
      ws.close();
    });

    it('rejects pending requests when browser disconnects mid-flight', async () => {
      const port = nextPort();
      const b = await bridge(port);
      const ws = await connectClient(port);
      await new Promise(r => setTimeout(r, 30));

      const pending = b.executeAction({ action: 'resetView' });
      setTimeout(() => ws.close(), 20);

      await expect(pending).rejects.toThrow(/[Dd]isconnect/);
    });
  });
});
