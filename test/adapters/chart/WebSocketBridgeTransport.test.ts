import { randomBytes } from 'node:crypto';
import { afterEach, describe, expect, it } from 'vitest';
import { WebSocket } from 'ws';
import { createBridgeProof, parsePairingToken, verifyBridgeProof } from '../../../src/adapters/outbound/chart/bridgeAuth.js';
import {
  BRIDGE_MAX_PAYLOAD_BYTES,
  WebSocketBridgeTransport,
} from '../../../src/adapters/outbound/chart/WebSocketBridgeTransport.js';
import { resolveBridgeConfig } from '../../../src/bootstrap/bridgeConfig.js';

const TOKEN = 'AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8';
const WRONG_TOKEN = 'ICEiIyQlJicoKSorLC0uLzAxMjM0NTY3ODk6Ozw9Pj8';
let portSeed = 17400;

function nonce(): string {
  return randomBytes(32).toString('base64url');
}

function pairedConfig(port: number, authTimeoutMs = 5_000) {
  return {
    ...resolveBridgeConfig({ ROMACO_MCP_BRIDGE_AUTH: 'required', ROMACO_MCP_BRIDGE_TOKEN: TOKEN }, []),
    port,
    authTimeoutMs,
  };
}

function nextJson(ws: WebSocket): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    ws.once('message', (raw) => {
      try {
        resolve(JSON.parse(raw.toString()) as Record<string, unknown>);
      } catch (error) {
        reject(error);
      }
    });
  });
}

function closed(ws: WebSocket): Promise<number> {
  return new Promise((resolve) => ws.once('close', resolve));
}

describe('WebSocketBridgeTransport paired v2', () => {
  const bridges: WebSocketBridgeTransport[] = [];
  const sockets: WebSocket[] = [];

  afterEach(async () => {
    for (const ws of sockets.splice(0)) {
      if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) ws.close();
    }
    for (const bridge of bridges.splice(0)) bridge.close();
    await new Promise((resolve) => setTimeout(resolve, 20));
  });

  async function start(authTimeoutMs = 5_000): Promise<{ bridge: WebSocketBridgeTransport; port: number }> {
    const port = portSeed++;
    const bridge = new WebSocketBridgeTransport(pairedConfig(port, authTimeoutMs));
    bridges.push(bridge);
    await bridge.start();
    return { bridge, port };
  }

  async function connect(port: number, origin?: string): Promise<WebSocket> {
    const ws = new WebSocket(`ws://127.0.0.1:${port}`, origin ? { headers: { origin } } : undefined);
    sockets.push(ws);
    await new Promise<void>((resolve, reject) => {
      ws.once('open', resolve);
      ws.once('error', reject);
    });
    return ws;
  }

  async function authenticate(ws: WebSocket, clientNonce = nonce()): Promise<Record<string, unknown>> {
    const challengePromise = nextJson(ws);
    ws.send(JSON.stringify({ type: 'bridge_hello', supportedVersions: [2], clientNonce }));
    const challenge = await challengePromise;
    expect(challenge).toMatchObject({ type: 'bridge_challenge', protocolVersion: 2, clientNonce });
    const token = parsePairingToken(TOKEN)!;
    expect(verifyBridgeProof(
      token,
      'server',
      clientNonce,
      challenge.serverNonce as string,
      challenge.serverProof,
    )).toBe(true);

    const authenticatedPromise = nextJson(ws);
    ws.send(JSON.stringify({
      type: 'bridge_authenticate',
      protocolVersion: 2,
      clientNonce,
      serverNonce: challenge.serverNonce,
      clientProof: createBridgeProof(token, 'client', clientNonce, challenge.serverNonce as string),
    }));
    expect(await authenticatedPromise).toEqual({ type: 'bridge_authenticated', protocolVersion: 2 });
    return challenge;
  }

  async function pair(ws: WebSocket, chartId = 'chart-v2'): Promise<void> {
    await authenticate(ws);
    const pingPromise = nextJson(ws);
    ws.send(JSON.stringify({ type: 'ready', protocolVersion: 2, chartId }));
    expect(await pingPromise).toEqual({ type: 'ping' });
  }

  it('authenticates mutually before adopting a chart', async () => {
    const { bridge, port } = await start();
    const ws = await connect(port);
    await pair(ws);
    expect(bridge.isConnected).toBe(true);
    expect(bridge.chartId).toBe('chart-v2');
  });

  it('rejects an incorrect client proof with 4401', async () => {
    const { port } = await start();
    const ws = await connect(port);
    const clientNonce = nonce();
    const challengePromise = nextJson(ws);
    ws.send(JSON.stringify({ type: 'bridge_hello', supportedVersions: [2], clientNonce }));
    const challenge = await challengePromise;
    const closePromise = closed(ws);
    ws.send(JSON.stringify({
      type: 'bridge_authenticate',
      protocolVersion: 2,
      clientNonce,
      serverNonce: challenge.serverNonce,
      clientProof: createBridgeProof(parsePairingToken(WRONG_TOKEN)!, 'client', clientNonce, challenge.serverNonce as string),
    }));
    expect(await closePromise).toBe(4401);
  });

  it('rejects ready before authentication with 4401', async () => {
    const { bridge, port } = await start();
    const ws = await connect(port, 'http://localhost:4321');
    const closePromise = closed(ws);
    ws.send(JSON.stringify({ type: 'ready', protocolVersion: 2, chartId: 'attacker' }));
    expect(await closePromise).toBe(4401);
    expect(bridge.isConnected).toBe(false);
  });

  it('rejects protocol version mismatch with 4406', async () => {
    const { port } = await start();
    const ws = await connect(port);
    const closePromise = closed(ws);
    ws.send(JSON.stringify({ type: 'bridge_hello', supportedVersions: [1], clientNonce: nonce() }));
    expect(await closePromise).toBe(4406);
  });

  it('rejects replayed client nonces with 4409', async () => {
    const { port } = await start();
    const clientNonce = nonce();
    const first = await connect(port);
    const challengePromise = nextJson(first);
    first.send(JSON.stringify({ type: 'bridge_hello', supportedVersions: [2], clientNonce }));
    await challengePromise;
    first.close();

    const second = await connect(port);
    const closePromise = closed(second);
    second.send(JSON.stringify({ type: 'bridge_hello', supportedVersions: [2], clientNonce }));
    expect(await closePromise).toBe(4409);
  });

  it('closes stalled authentication with 4408', async () => {
    const { port } = await start(25);
    const ws = await connect(port);
    expect(await closed(ws)).toBe(4408);
  });

  it('rejects oversized browser frames before authentication parsing', async () => {
    const { port } = await start();
    const ws = await connect(port);
    const closePromise = closed(ws);
    ws.send(Buffer.alloc(BRIDGE_MAX_PAYLOAD_BYTES + 1, 0x78));
    expect(await closePromise).toBe(1009);
  });

  it('never transmits the pairing token in server frames', async () => {
    const { port } = await start();
    const ws = await connect(port);
    const frames: string[] = [];
    ws.on('message', (raw) => frames.push(raw.toString()));
    await pair(ws);
    expect(frames.join('\n')).not.toContain(TOKEN);
  });

  it('does not let an unauthenticated localhost page replace the active chart', async () => {
    const { bridge, port } = await start();
    const legitimate = await connect(port, 'http://localhost:4321');
    await pair(legitimate, 'legitimate');

    const attacker = await connect(port, 'http://localhost:9999');
    const closePromise = closed(attacker);
    attacker.send(JSON.stringify({ type: 'ready', protocolVersion: 2, chartId: 'attacker' }));
    expect(await closePromise).toBe(4401);
    expect(bridge.chartId).toBe('legitimate');
  });

  it('accepts authenticated ready re-announcements for chart changes', async () => {
    const { bridge, port } = await start();
    const announced: Array<string | null> = [];
    bridge.setOnReady(() => announced.push(bridge.chartId));
    const ws = await connect(port);
    await pair(ws, 'chart-a');
    await new Promise((resolve) => setTimeout(resolve, 0));

    ws.send(JSON.stringify({ type: 'ready', protocolVersion: 2, chartId: 'chart-b' }));
    await new Promise((resolve) => setTimeout(resolve, 10));

    expect(bridge.chartId).toBe('chart-b');
    expect(announced).toEqual(['chart-a', 'chart-b']);
    expect(ws.readyState).toBe(WebSocket.OPEN);
  });

  it('accepts a response only from the socket that owns the pending request', async () => {
    const { bridge, port } = await start();
    const owner = await connect(port);
    await pair(owner, 'owner');
    const stranger = await connect(port);
    await authenticate(stranger);

    const requestFrame = nextJson(owner);
    const resultPromise = bridge.executeAction({ action: 'resetView' });
    const request = await requestFrame;
    const strangerClose = closed(stranger);
    stranger.send(JSON.stringify({
      type: 'action_result',
      requestId: request.requestId,
      result: { success: true, data: 'spoofed' },
    }));
    expect(await strangerClose).toBe(4400);

    owner.send(JSON.stringify({
      type: 'action_result',
      requestId: request.requestId,
      result: { success: true, data: 'owner' },
    }));
    await expect(resultPromise).resolves.toEqual({ success: true, data: 'owner' });
  });

  it('keeps pending ownership when handleResult receives a valid spoofed response', () => {
    const bridge = new WebSocketBridgeTransport(pairedConfig(portSeed++));
    const owner = {} as WebSocket;
    const stranger = {} as WebSocket;
    let resolved: unknown;
    const timer = setTimeout(() => undefined, 60_000);
    const internal = bridge as unknown as {
      pending: Map<string, {
        resolve(value: unknown): void;
        reject(reason: Error): void;
        timer: ReturnType<typeof setTimeout>;
        socket: WebSocket;
      }>;
      handleResult(message: unknown, ws: WebSocket): void;
    };
    internal.pending.set('owned', {
      resolve: (value) => { resolved = value; },
      reject: () => undefined,
      timer,
      socket: owner,
    });

    internal.handleResult({ type: 'action_result', requestId: 'owned', result: { success: true, data: 'spoofed' } }, stranger);
    expect(resolved).toBeUndefined();
    expect(internal.pending.has('owned')).toBe(true);

    internal.handleResult({ type: 'action_result', requestId: 'owned', result: { success: true, data: 'owner' } }, owner);
    expect(resolved).toEqual({ success: true, data: 'owner' });
    expect(internal.pending.has('owned')).toBe(false);
  });
});
