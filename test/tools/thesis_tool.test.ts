import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createTestClient } from './_client.js';
import { session } from '../../src/session.js';
import { uptrendCandles } from '../compression/fixtures.js';
import { analyzeSession } from '../../src/compression/analyze.js';
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

const DISCLAIMER = '⚠️ Not investment advice — educational purposes only.';

// thesis.ts appends DISCLAIMER in-code to every success output. Assert it's
// present, then parse the JSON that precedes it.
function parseThesis(text: string): any {
  expect(text).toContain(DISCLAIMER);
  return JSON.parse(text.replace(DISCLAIMER, '').trim());
}

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
      const t = parseThesis(res.text);
      expect(t).toHaveProperty('verdict');
      expect(t).toHaveProperty('bias');
      expect(t).toHaveProperty('bull');
      expect(t).toHaveProperty('bear');
      expect(t.analysisId).toMatch(/^analysis_/);
      expect(t.datasetId).toMatch(/^dataset_/);
      expect(t.provider).toBe('local');
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

  it('reuses the same artifact for repeated free thesis calls', async () => {
    const { callTool, close } = await createTestClient();
    try {
      const first = parseThesis((await callTool('romaco_thesis', {})).text);
      const second = parseThesis((await callTool('romaco_thesis', {})).text);
      expect(second.analysisId).toBe(first.analysisId);
      expect(second.datasetId).toBe(first.datasetId);
    } finally {
      await close();
    }
  });

  it('Pro path fails closed without explicit candle-egress authorization', async () => {
    process.env.ROMACO_TOKEN = 'sk-pro';
    const deep = analyzeSession(uptrendCandles(220, 100, 0.6)).thesis;
    const fetchMock = vi.fn(async () => fakeResponse({ status: 200, json: deep }));
    vi.stubGlobal('fetch', fetchMock);

    const { callTool, close } = await createTestClient();
    try {
      const res = await callTool('romaco_thesis', {});
      expect(res.isError).toBe(false);
      const artifact = parseThesis(res.text);
      expect(artifact.provider).toBe('local');
      expect(artifact.warning).toMatch(/remote egress disabled; computed locally/i);
      expect(fetchMock).not.toHaveBeenCalled();
    } finally {
      await close();
    }
  });

  it('Pro path never attempts network fallback implicitly', async () => {
    process.env.ROMACO_TOKEN = 'sk-pro';
    vi.stubGlobal('fetch', vi.fn(async () => {
      throw new Error('ECONNREFUSED');
    }));

    const { callTool, close } = await createTestClient();
    try {
      const res = await callTool('romaco_thesis', {});
      expect(res.isError).toBe(false);
      const artifact = parseThesis(res.text);
      expect(artifact.provider).toBe('local');
      expect(artifact.warning).toMatch(/computed locally/i);
    } finally {
      await close();
    }
  });

  it('Pro path does not transmit even an invalid token', async () => {
    process.env.ROMACO_TOKEN = 'sk-bad';
    const fetchMock = vi.fn(async () => fakeResponse({ status: 401, ok: false }));
    vi.stubGlobal('fetch', fetchMock);

    const { callTool, close } = await createTestClient();
    try {
      const res = await callTool('romaco_thesis', {});
      expect(res.isError).toBe(false);
      const artifact = parseThesis(res.text);
      expect(artifact.provider).toBe('local');
      expect(artifact.warning).toMatch(/computed locally/i);
      expect(fetchMock).not.toHaveBeenCalled();
    } finally {
      await close();
    }
  });
});
