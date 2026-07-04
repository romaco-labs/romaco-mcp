// Gate de Origin del bridge (fix pre-release v0.0.4):
// - bind loopback-only (127.0.0.1) — antes escuchaba en todas las interfaces.
// - páginas web de origins desconocidos NO pueden conectarse (los browsers
//   siempre mandan Origin; una página maliciosa en el mismo browser podía
//   controlar el chart vía ws://localhost).
// - sin Origin (tests/CLIs/clientes node) se permite — un proceso local
//   nativo falsifica lo que sea; no es la amenaza del allowlist.
import { describe, it, expect, afterEach, beforeEach } from 'vitest';
import { WebSocket } from 'ws';
import { RomacoBridge, isAllowedOrigin } from '../src/bridge.js';

let portSeed = 15300;
const nextPort = () => portSeed++;

describe('isAllowedOrigin', () => {
  beforeEach(() => {
    delete process.env.ROMACO_MCP_ALLOWED_ORIGINS;
  });

  it('permite conexiones sin Origin (no-browser)', () => {
    expect(isAllowedOrigin(undefined)).toBe(true);
    expect(isAllowedOrigin('')).toBe(true);
  });

  it('permite localhost/loopback en cualquier puerto y esquema', () => {
    expect(isAllowedOrigin('http://localhost:4321')).toBe(true);
    expect(isAllowedOrigin('https://localhost')).toBe(true);
    expect(isAllowedOrigin('http://127.0.0.1:3000')).toBe(true);
    expect(isAllowedOrigin('http://[::1]:8080')).toBe(true);
  });

  it('permite romaco.io y subdominios', () => {
    expect(isAllowedOrigin('https://romaco.io')).toBe(true);
    expect(isAllowedOrigin('https://www.romaco.io')).toBe(true);
    expect(isAllowedOrigin('https://app.romaco.io')).toBe(true);
  });

  it('rechaza origins desconocidos y lookalikes', () => {
    expect(isAllowedOrigin('https://evil.com')).toBe(false);
    expect(isAllowedOrigin('https://notromaco.io')).toBe(false);
    expect(isAllowedOrigin('https://romaco.io.evil.com')).toBe(false);
    expect(isAllowedOrigin('garbage-not-a-url')).toBe(false);
  });

  it('permite origins extra vía ROMACO_MCP_ALLOWED_ORIGINS', () => {
    process.env.ROMACO_MCP_ALLOWED_ORIGINS = 'https://miapp.com, https://otra.com/';
    expect(isAllowedOrigin('https://miapp.com')).toBe(true);
    expect(isAllowedOrigin('https://otra.com')).toBe(true);
    expect(isAllowedOrigin('https://tercera.com')).toBe(false);
  });
});

describe('RomacoBridge origin gate (integración)', () => {
  const bridges: RomacoBridge[] = [];

  afterEach(() => {
    for (const b of bridges.splice(0)) b.close();
    delete process.env.ROMACO_MCP_ALLOWED_ORIGINS;
  });

  async function startBridge(port: number) {
    const bridge = new RomacoBridge(port);
    await bridge.start();
    bridges.push(bridge);
    return bridge;
  }

  it('cierra con 4403 una conexión de origin malicioso', async () => {
    const port = nextPort();
    await startBridge(port);

    const ws = new WebSocket(`ws://127.0.0.1:${port}`, {
      headers: { origin: 'https://evil.com' },
    });
    const code = await new Promise<number>((resolve, reject) => {
      ws.once('close', (c) => resolve(c));
      ws.once('error', reject);
    });
    expect(code).toBe(4403);
  });

  it('acepta un cliente browser desde localhost (Origin presente)', async () => {
    const port = nextPort();
    const bridge = await startBridge(port);

    const ws = new WebSocket(`ws://127.0.0.1:${port}`, {
      headers: { origin: 'http://localhost:4321' },
    });
    await new Promise<void>((resolve, reject) => {
      ws.once('open', resolve);
      ws.once('error', reject);
    });
    // Contrato real: el cliente manda 'ready' y el bridge lo adopta (ping).
    const adopted = new Promise<void>((resolve) => {
      ws.on('message', (raw) => {
        try {
          if ((JSON.parse(raw.toString()) as { type?: string }).type === 'ping') resolve();
        } catch {
          /* ignore */
        }
      });
    });
    ws.send(JSON.stringify({ type: 'ready', chartId: 'test' }));
    await adopted;
    expect(bridge.isConnected).toBe(true);
    ws.close();
  });

  it('sigue aceptando clientes sin Origin (tests/CLIs)', async () => {
    const port = nextPort();
    await startBridge(port);

    const ws = new WebSocket(`ws://127.0.0.1:${port}`);
    await new Promise<void>((resolve, reject) => {
      ws.once('open', resolve);
      ws.once('error', reject);
    });
    ws.close();
  });
});
