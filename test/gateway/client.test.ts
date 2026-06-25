import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  callGateway,
  gatewayApiUrl,
  GatewayError,
  isAuthError,
  isPro,
} from '../../src/gateway/client.js';

// Snapshot env we mutate so each test starts clean.
const ENV_KEYS = ['ROMACO_TOKEN', 'ROMACO_API_URL'] as const;
const saved: Record<string, string | undefined> = {};

beforeEach(() => {
  for (const k of ENV_KEYS) saved[k] = process.env[k];
  for (const k of ENV_KEYS) delete process.env[k];
});

afterEach(() => {
  for (const k of ENV_KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k]!;
  }
  vi.restoreAllMocks();
});

/** Build a minimal Response-like stub for the global fetch mock. */
function fakeResponse(opts: { status?: number; ok?: boolean; json?: unknown; text?: string }) {
  const status = opts.status ?? 200;
  return {
    status,
    ok: opts.ok ?? (status >= 200 && status < 300),
    json: async () => opts.json,
    text: async () => opts.text ?? '',
  } as Response;
}

describe('isPro', () => {
  it('false when ROMACO_TOKEN unset', () => {
    expect(isPro()).toBe(false);
  });

  it('true when ROMACO_TOKEN set', () => {
    process.env.ROMACO_TOKEN = 'sk-test';
    expect(isPro()).toBe(true);
  });

  it('false when ROMACO_TOKEN is empty string', () => {
    process.env.ROMACO_TOKEN = '';
    expect(isPro()).toBe(false);
  });
});

describe('gatewayApiUrl', () => {
  it('defaults to localhost:8000', () => {
    expect(gatewayApiUrl()).toBe('http://localhost:8000');
  });

  it('honors ROMACO_API_URL override', () => {
    process.env.ROMACO_API_URL = 'https://api.romaco.tech';
    expect(gatewayApiUrl()).toBe('https://api.romaco.tech');
  });

  it('strips trailing slashes', () => {
    process.env.ROMACO_API_URL = 'https://api.romaco.tech///';
    expect(gatewayApiUrl()).toBe('https://api.romaco.tech');
  });
});

describe('callGateway', () => {
  it('throws GatewayError when no token configured', async () => {
    await expect(callGateway('/gateway/analyze', {})).rejects.toBeInstanceOf(GatewayError);
  });

  it('sends Bearer token, correct URL and JSON body, returns parsed payload', async () => {
    process.env.ROMACO_TOKEN = 'sk-abc';
    const payload = { trend: 'up', strength: 0.9 };
    const fetchMock = vi.fn(async () => fakeResponse({ status: 200, json: payload }));
    vi.stubGlobal('fetch', fetchMock);

    const out = await callGateway('/gateway/analyze', { symbol: 'AAPL' });

    expect(out).toEqual(payload);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('http://localhost:8000/gateway/analyze');
    expect(init.method).toBe('POST');
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer sk-abc');
    expect((init.headers as Record<string, string>)['Content-Type']).toBe('application/json');
    expect(init.body).toBe(JSON.stringify({ symbol: 'AAPL' }));
  });

  it('uses ROMACO_API_URL override in the request URL', async () => {
    process.env.ROMACO_TOKEN = 'sk-abc';
    process.env.ROMACO_API_URL = 'https://api.romaco.tech';
    const fetchMock = vi.fn(async () => fakeResponse({ status: 200, json: {} }));
    vi.stubGlobal('fetch', fetchMock);

    await callGateway('/gateway/levels', {});

    const [url] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://api.romaco.tech/gateway/levels');
  });

  it('401 → GatewayError(status=401), flagged as auth error', async () => {
    process.env.ROMACO_TOKEN = 'sk-bad';
    vi.stubGlobal('fetch', vi.fn(async () => fakeResponse({ status: 401, ok: false })));

    const err = await callGateway('/gateway/analyze', {}).catch((e) => e);
    expect(err).toBeInstanceOf(GatewayError);
    expect((err as GatewayError).status).toBe(401);
    expect(isAuthError(err)).toBe(true);
  });

  it('403 → GatewayError(status=403), flagged as auth error', async () => {
    process.env.ROMACO_TOKEN = 'sk-revoked';
    vi.stubGlobal('fetch', vi.fn(async () => fakeResponse({ status: 403, ok: false })));

    const err = await callGateway('/gateway/analyze', {}).catch((e) => e);
    expect(err).toBeInstanceOf(GatewayError);
    expect((err as GatewayError).status).toBe(403);
    expect(isAuthError(err)).toBe(true);
  });

  it('500 → GatewayError(status=500), NOT an auth error (caller falls back to local)', async () => {
    process.env.ROMACO_TOKEN = 'sk-ok';
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => fakeResponse({ status: 500, ok: false, text: 'boom' })),
    );

    const err = await callGateway('/gateway/analyze', {}).catch((e) => e);
    expect(err).toBeInstanceOf(GatewayError);
    expect((err as GatewayError).status).toBe(500);
    expect(isAuthError(err)).toBe(false);
  });

  it('network failure → GatewayError without status (caller falls back to local)', async () => {
    process.env.ROMACO_TOKEN = 'sk-ok';
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error('ECONNREFUSED');
      }),
    );

    const err = await callGateway('/gateway/analyze', {}).catch((e) => e);
    expect(err).toBeInstanceOf(GatewayError);
    expect((err as GatewayError).status).toBeUndefined();
    expect(isAuthError(err)).toBe(false);
  });
});

describe('isAuthError', () => {
  it('false for a plain Error', () => {
    expect(isAuthError(new Error('nope'))).toBe(false);
  });

  it('false for non-error values', () => {
    expect(isAuthError('401')).toBe(false);
    expect(isAuthError(null)).toBe(false);
  });
});
