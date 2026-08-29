import type { IncomingMessage } from 'node:http';
import { WebSocketServer, type WebSocket } from 'ws';
import { createBridgeProof, createNonce, isCanonicalNonce, NonceReplayCache, verifyBridgeProof } from './bridgeAuth.js';
import { BRIDGE_PROTOCOL_VERSION } from './bridgeProtocol.js';
import type { ActionResult, BridgeAction, BridgeClientMessage, BridgeServerMessage, BridgeTransportConfig, PendingRequest } from './bridgeProtocol.js';
import { MAX_CHART_TRANSFER_BYTES } from '../../../domain/chart/model.js';

const REQUEST_TIMEOUT_MS = 8_000;
const REBIND_MS = 5_000;
const LOCAL_HOSTNAMES = new Set(['localhost', '127.0.0.1', '::1', '[::1]']);
export const BRIDGE_MAX_PAYLOAD_BYTES = MAX_CHART_TRANSFER_BYTES;

type ConnectionPhase = 'hello' | 'challenge' | 'authenticated' | 'ready' | 'legacy';

interface ConnectionState {
  phase: ConnectionPhase;
  timer: ReturnType<typeof setTimeout> | null;
  clientNonce?: string;
  serverNonce?: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isReadyMessage(value: unknown, paired: boolean): value is Extract<BridgeClientMessage, { type: 'ready' }> {
  if (!isRecord(value) || value.type !== 'ready') return false;
  if (typeof value.chartId !== 'string' || value.chartId.length === 0 || value.chartId.length > 256) return false;
  return paired ? value.protocolVersion === BRIDGE_PROTOCOL_VERSION : value.protocolVersion === undefined || value.protocolVersion === BRIDGE_PROTOCOL_VERSION;
}

export function isAllowedOrigin(origin: string | undefined, allowedOrigins: ReadonlySet<string>): boolean {
  if (!origin) return true;
  let url: URL;
  try {
    url = new URL(origin);
  } catch {
    return false;
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return false;
  if (url.username || url.password || url.pathname !== '/' || url.search || url.hash) return false;
  if (origin !== url.origin) return false;
  if (LOCAL_HOSTNAMES.has(url.hostname.toLowerCase())) return true;
  return allowedOrigins.has(url.origin);
}

export class WebSocketBridgeTransport {
  private wss: WebSocketServer | null = null;
  private client: WebSocket | null = null;
  private readonly pending = new Map<string, PendingRequest>();
  private readonly connections = new Map<WebSocket, ConnectionState>();
  private readonly replayCache = new NonceReplayCache();
  private onReadyCb: (() => void) | null = null;
  private rebindTimer: ReturnType<typeof setTimeout> | null = null;
  private activeChartId: string | null = null;

  constructor(private readonly config: BridgeTransportConfig) {}

  setOnReady(cb: () => void): void {
    this.onReadyCb = cb;
  }

  close(): void {
    if (this.rebindTimer) {
      clearTimeout(this.rebindTimer);
      this.rebindTimer = null;
    }
    for (const state of this.connections.values()) {
      if (state.timer) clearTimeout(state.timer);
    }
    this.connections.clear();
    this.wss?.close();
  }

  start(): Promise<void> {
    if (!this.config.enabled) {
      console.error(`[romaco-mcp] Chart bridge disabled: ${this.config.disabledReason ?? 'invalid configuration'}`);
      return Promise.resolve();
    }
    if (this.config.authMode === 'legacy') {
      console.error('[romaco-mcp] WARNING: chart bridge legacy mode has no endpoint authentication. Configure ROMACO_MCP_BRIDGE_TOKEN.');
    }
    return new Promise((resolve) => this.bind(resolve));
  }

  private bind(onSettled?: () => void): void {
    const wss = new WebSocketServer({
      port: this.config.port,
      host: '127.0.0.1',
      maxPayload: BRIDGE_MAX_PAYLOAD_BYTES,
    });
    this.wss = wss;
    wss.on('error', (error) => {
      if ((error as NodeJS.ErrnoException).code === 'EADDRINUSE') {
        console.error(`[romaco-mcp] Port ${this.config.port} busy. Tools are up; retrying chart bridge every ${REBIND_MS / 1000}s…`);
        try {
          wss.close();
        } catch {
          // Already closed.
        }
        if (this.wss === wss) this.wss = null;
        onSettled?.();
        this.rebindTimer = setTimeout(() => this.bind(), REBIND_MS);
      } else {
        console.error(`[romaco-mcp] Bridge error: ${error instanceof Error ? error.message : String(error)}`);
        onSettled?.();
      }
    });
    wss.on('listening', () => {
      console.error(`[romaco-mcp] WebSocket bridge listening on ws://localhost:${this.config.port} (${this.config.authMode})`);
      onSettled?.();
    });
    wss.on('connection', (ws, request) => this.handleConnection(ws, request));
  }

  private handleConnection(ws: WebSocket, request: IncomingMessage): void {
    const origin = request.headers.origin;
    if (!isAllowedOrigin(origin, this.config.allowedOrigins)) {
      console.error(`[romaco-mcp] Bridge connection rejected from origin "${origin}".`);
      ws.close(4403, 'origin denied');
      return;
    }

    const state: ConnectionState = {
      phase: this.config.authMode === 'required' ? 'hello' : 'legacy',
      timer: null,
    };
    if (this.config.authMode === 'required') {
      state.timer = setTimeout(() => this.closeProtocol(ws, 4408, 'auth timeout'), this.config.authTimeoutMs);
    }
    this.connections.set(ws, state);

    ws.on('message', (raw) => {
      let message: unknown;
      try {
        message = JSON.parse(raw.toString());
      } catch {
        this.closeProtocol(ws, 4400, 'malformed protocol');
        return;
      }
      if (this.config.authMode === 'required') this.handlePairedMessage(message, ws, state);
      else this.handleLegacyMessage(message, ws, state);
    });

    ws.on('close', () => this.handleClose(ws, state));
    ws.on('error', () => {
      // Close owns cleanup.
    });
  }

  private handlePairedMessage(message: unknown, ws: WebSocket, state: ConnectionState): void {
    if (!isRecord(message) || typeof message.type !== 'string') {
      this.closeProtocol(ws, 4400, 'malformed protocol');
      return;
    }

    if (state.phase === 'hello') {
      if (message.type !== 'bridge_hello') {
        this.closeProtocol(ws, message.type === 'ready' ? 4401 : 4400, 'auth required');
        return;
      }
      if (!Array.isArray(message.supportedVersions) || !message.supportedVersions.every(Number.isInteger)) {
        this.closeProtocol(ws, 4400, 'malformed protocol');
        return;
      }
      if (!message.supportedVersions.includes(BRIDGE_PROTOCOL_VERSION)) {
        this.closeProtocol(ws, 4406, 'no common protocol version');
        return;
      }
      if (!isCanonicalNonce(message.clientNonce)) {
        this.closeProtocol(ws, 4400, 'malformed client nonce');
        return;
      }
      if (!this.replayCache.reserve(message.clientNonce)) {
        this.closeProtocol(ws, 4409, 'replay detected');
        return;
      }
      const token = this.config.token;
      if (!token) {
        this.closeProtocol(ws, 4401, 'auth unavailable');
        return;
      }
      state.clientNonce = message.clientNonce;
      state.serverNonce = createNonce();
      state.phase = 'challenge';
      this.sendTo(ws, {
        type: 'bridge_challenge',
        protocolVersion: BRIDGE_PROTOCOL_VERSION,
        clientNonce: state.clientNonce,
        serverNonce: state.serverNonce,
        serverProof: createBridgeProof(token, 'server', state.clientNonce, state.serverNonce),
      });
      return;
    }

    if (state.phase === 'challenge') {
      if (message.type !== 'bridge_authenticate') {
        this.closeProtocol(ws, message.type === 'ready' ? 4401 : 4400, 'auth required');
        return;
      }
      const token = this.config.token;
      if (
        !token ||
        message.protocolVersion !== BRIDGE_PROTOCOL_VERSION ||
        message.clientNonce !== state.clientNonce ||
        message.serverNonce !== state.serverNonce ||
        !verifyBridgeProof(token, 'client', state.clientNonce!, state.serverNonce!, message.clientProof)
      ) {
        this.closeProtocol(ws, 4401, 'auth failed');
        return;
      }
      if (state.timer) clearTimeout(state.timer);
      state.timer = null;
      state.phase = 'authenticated';
      this.sendTo(ws, { type: 'bridge_authenticated', protocolVersion: BRIDGE_PROTOCOL_VERSION });
      return;
    }

    if (state.phase === 'authenticated') {
      if (!isReadyMessage(message, true)) {
        this.closeProtocol(ws, 4400, 'ready required');
        return;
      }
      state.phase = 'ready';
      this.handleReady(message, ws);
      return;
    }

    if (state.phase === 'ready') {
      if (isReadyMessage(message, true)) {
        this.handleReady(message, ws);
        return;
      }
      this.handleResult(message, ws);
    }
  }

  private handleLegacyMessage(message: unknown, ws: WebSocket, state: ConnectionState): void {
    if (state.phase === 'legacy') {
      if (!isReadyMessage(message, false)) {
        this.closeProtocol(ws, 4400, 'ready required');
        return;
      }
      state.phase = 'ready';
      this.handleReady(message, ws);
      return;
    }
    if (isReadyMessage(message, false)) {
      this.handleReady(message, ws);
      return;
    }
    this.handleResult(message, ws);
  }

  private handleReady(message: Extract<BridgeClientMessage, { type: 'ready' }>, ws: WebSocket): void {
    this.adoptClient(ws);
    this.activeChartId = message.chartId;
    console.error(`[romaco-mcp] Chart ready — chartId: ${message.chartId}`);
    if (this.onReadyCb) {
      const callback = this.onReadyCb;
      void Promise.resolve().then(callback);
    }
  }

  private handleResult(message: unknown, ws: WebSocket): void {
    if (!isRecord(message) || typeof message.type !== 'string' || typeof message.requestId !== 'string') {
      this.closeProtocol(ws, 4400, 'malformed protocol');
      return;
    }
    if (!['error', 'action_result', 'context_result', 'snapshot_result'].includes(message.type)) {
      this.closeProtocol(ws, 4400, 'malformed protocol');
      return;
    }
    const pending = this.pending.get(message.requestId);
    if (!pending || pending.socket !== ws) return;

    clearTimeout(pending.timer);
    this.pending.delete(message.requestId);
    if (message.type === 'error' && typeof message.error === 'string') pending.reject(new Error(message.error));
    else if (message.type === 'action_result' && 'result' in message) pending.resolve(message.result);
    else if (message.type === 'context_result' && 'context' in message) pending.resolve(message.context);
    else if (message.type === 'snapshot_result' && typeof message.dataUrl === 'string') pending.resolve(message.dataUrl);
    else pending.reject(new Error('Malformed browser response'));
  }

  private handleClose(ws: WebSocket, state: ConnectionState): void {
    if (state.timer) clearTimeout(state.timer);
    this.connections.delete(ws);
    if (this.client === ws) {
      this.client = null;
      this.activeChartId = null;
      console.error('[romaco-mcp] Browser chart disconnected');
    }
    for (const [id, pending] of this.pending) {
      if (pending.socket !== ws) continue;
      pending.reject(new Error('Browser disconnected'));
      clearTimeout(pending.timer);
      this.pending.delete(id);
    }
  }

  private closeProtocol(ws: WebSocket, code: number, reason: string): void {
    if (ws.readyState === ws.OPEN) ws.close(code, reason);
  }

  private adoptClient(ws: WebSocket): void {
    if (this.client === ws) return;
    const previous = this.client;
    if (previous) {
      console.error('[romaco-mcp] Replacing existing browser client');
      for (const [id, pending] of this.pending) {
        if (pending.socket !== previous) continue;
        pending.reject(new Error('Browser connection replaced'));
        clearTimeout(pending.timer);
        this.pending.delete(id);
      }
      if (previous.readyState === previous.OPEN) previous.close(1000, 'Replaced by new connection');
    }
    this.client = ws;
    console.error('[romaco-mcp] Browser chart connected');
    this.sendTo(ws, { type: 'ping' });
  }

  get isConnected(): boolean {
    return this.client !== null && this.client.readyState === this.client.OPEN;
  }

  get chartId(): string | null {
    return this.isConnected ? this.activeChartId : null;
  }

  private sendTo(ws: WebSocket, message: BridgeServerMessage): void {
    if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(message));
  }

  private request<T>(message: BridgeServerMessage & { requestId: string }): Promise<T> {
    if (!this.isConnected) {
      return Promise.reject(new Error('No chart connected. Open the Romaco chart in your browser and add <McpBridge /> to your app.'));
    }
    const socket = this.client!;
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        const pending = this.pending.get(message.requestId);
        if (pending?.socket === socket) this.pending.delete(message.requestId);
        reject(new Error(`Request timed out after ${REQUEST_TIMEOUT_MS}ms`));
      }, REQUEST_TIMEOUT_MS);
      this.pending.set(message.requestId, { resolve: resolve as (value: unknown) => void, reject, timer, socket });
      this.sendTo(socket, message);
    });
  }

  async executeAction(action: BridgeAction): Promise<ActionResult> {
    return this.request<ActionResult>({ type: 'execute_action', requestId: crypto.randomUUID(), action });
  }

  async getContext(includeCandles = true): Promise<unknown> {
    return this.request<unknown>({ type: 'get_context', requestId: crypto.randomUUID(), includeCandles });
  }

  async captureSnapshot(format: 'png' | 'jpeg' = 'png'): Promise<string> {
    return this.request<string>({ type: 'capture_snapshot', requestId: crypto.randomUUID(), format });
  }
}
