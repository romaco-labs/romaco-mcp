/**
 * ROA-I gateway client.
 *
 * Free  (no ROMACO_TOKEN): tools compute locally via src/compression.
 * Pro   (ROMACO_TOKEN set): analysis tools forward the heavy compute to the
 *        ROA-I backend, falling back to local compute if it is unreachable.
 *
 * Dev:  ROMACO_API_URL=http://localhost:8000 (default).
 * Prod: ROMACO_API_URL=https://api.romaco.tech.
 */

const DEFAULT_API_URL = 'http://localhost:8000'; // prod: https://api.romaco.tech

/** Request timeout for gateway calls (ms) — keeps the Pro path from hanging before the local fallback. */
const GATEWAY_TIMEOUT_MS = 8000;

/** True when the user has configured a Pro API key. */
export function isPro(): boolean {
  return !!process.env.ROMACO_TOKEN;
}

/** Base URL of the ROA-I backend, without a trailing slash. */
export function gatewayApiUrl(): string {
  return (process.env.ROMACO_API_URL || DEFAULT_API_URL).replace(/\/+$/, '');
}

export class GatewayError extends Error {
  readonly status?: number;
  constructor(message: string, status?: number) {
    super(message);
    this.name = 'GatewayError';
    this.status = status;
  }
}

/** True when the error is an auth failure (invalid/revoked token) — surface it to the user instead of falling back. */
export function isAuthError(err: unknown): boolean {
  return err instanceof GatewayError && (err.status === 401 || err.status === 403);
}

/**
 * POST to a gateway endpoint with the ROMACO_TOKEN as a Bearer credential.
 * Throws GatewayError(status) on 401/403 (token), or GatewayError without a
 * status on a network/timeout failure — the caller decides whether to fall
 * back to local compute.
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
      `Could not reach ROA-I (${url}): ${err instanceof Error ? err.message : String(err)}`
    );
  }

  if (res.status === 401 || res.status === 403) {
    throw new GatewayError('ROMACO_TOKEN is invalid or revoked. Renew it at romaco.tech', res.status);
  }
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new GatewayError(`ROA-I gateway error ${res.status}: ${text.slice(0, 200)}`, res.status);
  }

  return (await res.json()) as T;
}
