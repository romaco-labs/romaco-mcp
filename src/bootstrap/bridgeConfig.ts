import { parsePairingToken } from '../adapters/outbound/chart/bridgeAuth.js';
import type { BridgeAuthMode, BridgeTransportConfig } from '../adapters/outbound/chart/bridgeProtocol.js';

export type RequestedBridgeAuthMode = 'auto' | BridgeAuthMode;

export type BridgeConfig = BridgeTransportConfig;

const DEFAULT_ORIGINS = ['https://romaco.io'];

function resolvePort(argv: readonly string[], env: NodeJS.ProcessEnv): number {
  const index = argv.indexOf('--port');
  const raw = index >= 0 ? argv[index + 1] : env.ROMACO_MCP_PORT;
  if (raw === undefined) return 7399;
  const port = Number.parseInt(raw, 10);
  return Number.isInteger(port) && port > 0 && port <= 65_535 ? port : 7399;
}

export function normalizeOrigin(value: string): string | null {
  try {
    const url = new URL(value);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
    if (url.username || url.password || url.pathname !== '/' || url.search || url.hash) return null;
    return url.origin;
  } catch {
    return null;
  }
}

function resolveOrigins(env: NodeJS.ProcessEnv): ReadonlySet<string> {
  const origins = new Set(DEFAULT_ORIGINS);
  for (const raw of (env.ROMACO_MCP_ALLOWED_ORIGINS ?? '').split(',')) {
    const normalized = normalizeOrigin(raw.trim());
    if (normalized) origins.add(normalized);
  }
  return origins;
}

export function resolveBridgeConfig(
  env: NodeJS.ProcessEnv = process.env,
  argv: readonly string[] = process.argv,
): BridgeConfig {
  const requested = (env.ROMACO_MCP_BRIDGE_AUTH ?? 'auto') as RequestedBridgeAuthMode;
  const tokenValue = env.ROMACO_MCP_BRIDGE_TOKEN;
  const token = parsePairingToken(tokenValue);
  const base = {
    port: resolvePort(argv, env),
    allowedOrigins: resolveOrigins(env),
    authTimeoutMs: 5_000,
  };

  if (!['auto', 'required', 'legacy'].includes(requested)) {
    return { ...base, authMode: 'required', token: null, enabled: false, disabledReason: `Invalid ROMACO_MCP_BRIDGE_AUTH: ${requested}` };
  }
  if (requested === 'legacy') return { ...base, authMode: 'legacy', token: null, enabled: true };
  if (tokenValue !== undefined && token === null) {
    return { ...base, authMode: 'required', token: null, enabled: false, disabledReason: 'ROMACO_MCP_BRIDGE_TOKEN must be exactly 32 bytes encoded as canonical base64url.' };
  }
  if (requested === 'required' && token === null) {
    return { ...base, authMode: 'required', token: null, enabled: false, disabledReason: 'ROMACO_MCP_BRIDGE_AUTH=required needs ROMACO_MCP_BRIDGE_TOKEN.' };
  }
  return token
    ? { ...base, authMode: 'required', token, enabled: true }
    : { ...base, authMode: 'legacy', token: null, enabled: true };
}
