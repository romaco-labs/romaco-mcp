import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createTestClient } from './_client.js';
import { session } from '../../src/session.js';
import { uptrendCandles } from '../compression/fixtures.js';
import type { LoadResponse } from '../../src/data/types.js';

const ENV_KEYS = ['ROMACO_TOKEN', 'ROMACO_API_URL'] as const;
const saved: Record<string, string | undefined> = {};

function loadSession(): void {
  const candles = uptrendCandles(220, 100, 0.6);
  const load: LoadResponse = {
    source: 'raw',
    symbol: 'TEST',
    timeframe: '1d',
    candles,
    fetched_at: Date.now(),
  };
  session.setLastLoad(load);
}

beforeEach(() => {
  for (const k of ENV_KEYS) saved[k] = process.env[k];
  for (const k of ENV_KEYS) delete process.env[k];
  loadSession();
});

afterEach(() => {
  for (const k of ENV_KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k]!;
  }
  session.clear();
  vi.restoreAllMocks();
});

function fakeResponse(opts: { status?: number; ok?: boolean; json?: unknown; text?: string }) {
  const status = opts.status ?? 200;
  return {
    status,
    ok: opts.ok ?? (status >= 200 && status < 300),
    json: async () => opts.json,
    text: async () => opts.text ?? '',
  } as Response;
}

describe('romaco_thesis tool', () => {
  it('free path: returns a structured thesis under 2 KB', async () => {
    const { callTool, close } = await createTestClient();
    try {
      const res = await callTool('romaco_thesis', {});
      expect(res.isError).toBe(false);
      expect(Buffer.byteLength(res.text, 'utf8')).toBeLessThan(2048);
      const t = JSON.parse(res.text);
      expect(t).toHaveProperty('verdict');
      expect(t).toHaveProperty('bias');
      expect(t).toHaveProperty('bull');
      expect(t).toHaveProperty('bear');
      expect(['long', 'short', 'stand_aside']).toContain(t.verdict);
    } finally {
      await close();
    }
  });

  it('errors clearly when no candles are loaded', async () => {
    session.clear();
    const { callTool, close } = await createTestClient();
    try {
      const res = await callTool('romaco_thesis', {});
      expect(res.isError).toBe(true);
      expect(res.text).toMatch(/load_candles/i);
    } finally {
      await close();
    }
  });

  it('Pro path: delegates to /gateway/thesis and returns the backend payload', async () => {
    process.env.ROMACO_TOKEN = 'sk-pro';
    const deep = { verdict: 'long', source: 'roa-i', confidence: 0.91 };
    const fetchMock = vi.fn(async () => fakeResponse({ status: 200, json: deep }));
    vi.stubGlobal('fetch', fetchMock);

    const { callTool, close } = await createTestClient();
    try {
      const res = await callTool('romaco_thesis', {});
      expect(res.isError).toBe(false);
      expect(JSON.parse(res.text)).toEqual(deep);
      const [url] = fetchMock.mock.calls[0] as [string];
      expect(url).toBe('http://localhost:8000/gateway/thesis');
    } finally {
      await close();
    }
  });

  it('Pro path: network failure falls back to local thesis (free behavior)', async () => {
    process.env.ROMACO_TOKEN = 'sk-pro';
    vi.stubGlobal('fetch', vi.fn(async () => {
      throw new Error('ECONNREFUSED');
    }));

    const { callTool, close } = await createTestClient();
    try {
      const res = await callTool('romaco_thesis', {});
      expect(res.isError).toBe(false);
      const t = JSON.parse(res.text);
      expect(t).toHaveProperty('verdict'); // local shape, not backend payload
      expect(t).toHaveProperty('horizon');
    } finally {
      await close();
    }
  });

  it('Pro path: invalid token (401) surfaces to the user, no silent fallback', async () => {
    process.env.ROMACO_TOKEN = 'sk-bad';
    vi.stubGlobal('fetch', vi.fn(async () => fakeResponse({ status: 401, ok: false })));

    const { callTool, close } = await createTestClient();
    try {
      const res = await callTool('romaco_thesis', {});
      expect(res.isError).toBe(true);
      expect(res.text).toMatch(/token/i);
    } finally {
      await close();
    }
  });
});
