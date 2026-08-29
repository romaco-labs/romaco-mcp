/**
 * Dormant low-level remote gateway client.
 *
 * Current MCP tools compute locally and never call this module. Environment
 * variables alone do not authorize candle or analysis egress. A future caller
 * needs an explicit authorization contract before invoking `callGateway`.
 */

const DEFAULT_API_URL = 'http://localhost:8000';

/** Bound any future explicitly authorized gateway call. */
const GATEWAY_TIMEOUT_MS = 8000;

/** Legacy compatibility predicate. A configured token enables no tool routing. */
export function isPro(): boolean {
  return !!process.env.ROMACO_TOKEN;
}

/** Reserved gateway base URL, without a trailing slash. */
export function gatewayApiUrl(): string {
  const raw = (process.env.ROMACO_API_URL || DEFAULT_API_URL).replace(/\/+$/, '');
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new GatewayError('ROMACO_API_URL must be a valid absolute URL.');
  }
  if (url.username || url.password) {
    throw new GatewayError('ROMACO_API_URL cannot contain embedded credentials.');
  }
  const loopback = new Set(['localhost', '127.0.0.1', '::1', '[::1]']);
  const secure = url.protocol === 'https:';
  const localHttp = url.protocol === 'http:' && loopback.has(url.hostname.toLowerCase());
  if (!secure && !localHttp) {
    throw new GatewayError('ROMACO_API_URL must use HTTPS unless it targets loopback.');
  }
  return raw;
}

export class GatewayError extends Error {
  readonly status?: number;
  constructor(message: string, status?: number) {
    super(message);
    this.name = 'GatewayError';
    this.status = status;
  }
}

/** True when a direct gateway caller receives an authentication failure. */
export function isAuthError(err: unknown): boolean {
  return err instanceof GatewayError && (err.status === 401 || err.status === 403);
}

/**
 * Low-level POST helper for a future explicitly authorized adapter. This
 * function is not registered as an MCP tool and current server composition
 * never calls it.
 */
export async function callGateway<T = unknown>(path: string, body: unknown): Promise<T> {
  const token = process.env.ROMACO_TOKEN;
  if (!token) {
    throw new GatewayError('ROMACO_TOKEN is not set.');
  }
  const url = `${gatewayApiUrl()}${path}`;

  let res: Response;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(GATEWAY_TIMEOUT_MS),
    });
  } catch (err) {
    throw new GatewayError(
      `Could not reach remote analysis gateway (${url}): ${err instanceof Error ? err.message : String(err)}`
    );
  }

  if (res.status === 401 || res.status === 403) {
    throw new GatewayError('ROMACO_TOKEN is invalid or revoked. Renew it at romaco.io', res.status);
  }
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new GatewayError(`Remote analysis gateway error ${res.status}: ${text.slice(0, 200)}`, res.status);
  }

  return (await res.json()) as T;
}
