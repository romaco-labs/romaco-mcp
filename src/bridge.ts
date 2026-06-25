import { WebSocketServer, type WebSocket } from 'ws';

function resolvePort(): number {
  // --port <n> CLI arg takes priority
  const argIdx = process.argv.indexOf('--port');
  if (argIdx !== -1 && process.argv[argIdx + 1]) {
    const n = parseInt(process.argv[argIdx + 1], 10);
    if (!Number.isNaN(n)) return n;
  }
  // ROMACO_MCP_PORT env var second
  const envPort = parseInt(process.env.ROMACO_MCP_PORT ?? '', 10);
  // Default WebSocket port (arbitrary high port; override with --port or ROMACO_MCP_PORT).
  return Number.isNaN(envPort) ? 7399 : envPort;
}
import type {
  BridgeAction,
  BridgeClientMessage,
  BridgeServerMessage,
  PendingRequest,
  ActionResult,
} from './types.js';

const REQUEST_TIMEOUT_MS = 8_000;
// When the port is held by a stale server, keep trying to claim it in the
// background so the bridge self-heals once the squatter dies — instead of
// crashing the whole MCP process on startup.
const REBIND_MS = 5_000;

export class RomacoBridge {
  private wss: WebSocketServer | null = null;
  private client: WebSocket | null = null;
  private pending = new Map<string, PendingRequest>();
  private readonly port: number;
  private onReadyCb: (() => void) | null = null;
  private rebindTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(port = 7399) {
    this.port = port;
  }

  /**
   * Register a callback fired when the browser chart announces `ready`. Used to
   * trigger state reconciliation (replay applied overlays) after the chart is
   * (re)created. Kept as an injected callback to avoid a bridge↔reconcile import cycle.
   */
  setOnReady(cb: () => void): void {
    this.onReadyCb = cb;
  }

  /** Gracefully close the WebSocket server. Used for cleanup in tests and shutdown. */
  close(): void {
    if (this.rebindTimer) {
      clearTimeout(this.rebindTimer);
      this.rebindTimer = null;
    }
    this.wss?.close();
  }

  /**
   * Start the chart bridge. Resolves as soon as the outcome is known — either
   * the port is listening, or it's busy and we've scheduled a background retry.
   * It NEVER rejects on EADDRINUSE: a stale server squatting the port must not
   * crash the MCP process. The headless tools stay fully available, and the
   * bridge keeps trying to claim the port until the squatter dies (paired with
   * McpBridge's infinite client-side retry, the whole thing self-heals).
   */
  start(): Promise<void> {
    return new Promise((resolve) => this.bind(resolve));
  }

  private bind(onSettled?: () => void): void {
    const wss = new WebSocketServer({ port: this.port });
    this.wss = wss;

    wss.on('error', (err) => {
      if ((err as NodeJS.ErrnoException).code === 'EADDRINUSE') {
        console.error(
          `[romaco-mcp] Port ${this.port} busy (stale server?). Tools are up; retrying the chart bridge every ${REBIND_MS / 1000}s…`
        );
        try {
          wss.close();
        } catch {
          /* already dead */
        }
        if (this.wss === wss) this.wss = null;
        onSettled?.(); // let the MCP server boot now
        this.rebindTimer = setTimeout(() => this.bind(), REBIND_MS);
      } else {
        console.error(`[romaco-mcp] Bridge error: ${err instanceof Error ? err.message : String(err)}`);
        onSettled?.();
      }
    });

    wss.on('listening', () => {
      console.error(`[romaco-mcp] WebSocket bridge listening on ws://localhost:${this.port}`);
      onSettled?.();
    });

    wss.on('connection', (ws) => this.handleConnection(ws));
  }

  private handleConnection(ws: WebSocket): void {
    // Do NOT claim the client slot on raw connection. On React StrictMode
    // double-mount the aborted first socket can finish its server-side
    // handshake AFTER the surviving one — claiming by connection order would
    // replace the live client with a zombie and close(1000) the real one,
    // which (by design) never retries. A socket proves liveness by sending
    // 'ready'; only then does it become THE client (see adoptClient).
    ws.on('message', (raw) => {
      try {
        const msg = JSON.parse(raw.toString()) as BridgeClientMessage;
        this.handleClientMessage(msg, ws);
      } catch {
        // ignore malformed messages
      }
    });

    ws.on('close', () => {
      if (this.client === ws) {
        this.client = null;
        console.error('[romaco-mcp] Browser chart disconnected');
      }
      // Only reject pending requests that belong to this socket.
      // Draining all entries would incorrectly cancel inflight requests
      // from a newer client that replaced this one.
      for (const [id, pending] of this.pending) {
        if (pending.socket !== ws) continue;
        pending.reject(new Error('Browser disconnected'));
        clearTimeout(pending.timer);
        this.pending.delete(id);
      }
    });

    ws.on('error', () => {
      // handled by close event
    });
  }

  /**
   * Promotes a socket that sent 'ready' to THE browser client, replacing any
   * prior one so we don't accumulate zombies on HMR / tab switches. In-flight
   * requests bound to the old client are rejected so the MCP caller doesn't
   * hang on a dead socket.
   */
  private adoptClient(ws: WebSocket): void {
    if (this.client === ws) return;
    if (this.client) {
      if (this.client.readyState === 1) {
        console.error('[romaco-mcp] Replacing existing browser client');
        this.client.close(1000, 'Replaced by new connection');
      }
      for (const [id, pending] of this.pending) {
        pending.reject(new Error('Browser connection replaced'));
        clearTimeout(pending.timer);
        this.pending.delete(id);
      }
    }
    this.client = ws;
    console.error('[romaco-mcp] Browser chart connected');
    this.send({ type: 'ping' });
  }

  get isConnected(): boolean {
    return this.client !== null && this.client.readyState === 1;
  }

  private send(msg: BridgeServerMessage): void {
    if (!this.isConnected) return;
    this.client!.send(JSON.stringify(msg));
  }

  private handleClientMessage(msg: BridgeClientMessage, ws?: WebSocket): void {
    if (msg.type === 'ready') {
      if (ws) this.adoptClient(ws);
      console.error(`[romaco-mcp] Chart ready — chartId: ${msg.chartId}`);
      // Fire reconcile off the message loop so a slow replay can't block the
      // socket; getContext/executeAction work now that the client is connected.
      if (this.onReadyCb) {
        const cb = this.onReadyCb;
        void Promise.resolve().then(cb);
      }
      return;
    }

    const pending = this.pending.get(msg.requestId);
    if (!pending) return;

    clearTimeout(pending.timer);
    this.pending.delete(msg.requestId);

    if (msg.type === 'error') {
      pending.reject(new Error(msg.error));
    } else if (msg.type === 'action_result') {
      pending.resolve(msg.result);
    } else if (msg.type === 'context_result') {
      pending.resolve(msg.context);
    } else if (msg.type === 'snapshot_result') {
      pending.resolve(msg.dataUrl);
    }
  }

  private request<T>(msg: BridgeServerMessage & { requestId: string }): Promise<T> {
    if (!this.isConnected) {
      return Promise.reject(
        new Error(
          'No chart connected. Open the Romaco chart in your browser and add <McpBridge /> to your app.'
        )
      );
    }

    const socket = this.client!;
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(msg.requestId);
        reject(new Error(`Request timed out after ${REQUEST_TIMEOUT_MS}ms`));
      }, REQUEST_TIMEOUT_MS);

      this.pending.set(msg.requestId, {
        resolve: resolve as (v: unknown) => void,
        reject,
        timer,
        socket,
      });

      this.send(msg);
    });
  }

  async executeAction(action: BridgeAction): Promise<ActionResult> {
    const requestId = crypto.randomUUID();
    return this.request<ActionResult>({ type: 'execute_action', requestId, action });
  }

  async getContext(includeCandles = true): Promise<unknown> {
    const requestId = crypto.randomUUID();
    return this.request<unknown>({ type: 'get_context', requestId, includeCandles });
  }

  async captureSnapshot(format: 'png' | 'jpeg' = 'png'): Promise<string> {
    const requestId = crypto.randomUUID();
    return this.request<string>({ type: 'capture_snapshot', requestId, format });
  }
}

/** Singleton bridge. Port resolved from --port CLI arg or ROMACO_MCP_PORT env var. */
export const bridge = new RomacoBridge(resolvePort());
