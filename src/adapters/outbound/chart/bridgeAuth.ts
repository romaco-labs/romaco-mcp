import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import type { BridgeAuthRole } from './bridgeProtocol.js';

const TOKEN_BYTES = 32;
const NONCE_BYTES = 32;
const CONTEXT = 'romaco-mcp-bridge-auth-v2';

function decodeCanonicalBase64Url(value: string, expectedBytes: number): Buffer | null {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) return null;
  try {
    const decoded = Buffer.from(value, 'base64url');
    if (decoded.byteLength !== expectedBytes || decoded.toString('base64url') !== value) return null;
    return decoded;
  } catch {
    return null;
  }
}

export function parsePairingToken(value: string | undefined): Buffer | null {
  return value ? decodeCanonicalBase64Url(value, TOKEN_BYTES) : null;
}

export function isCanonicalNonce(value: unknown): value is string {
  return typeof value === 'string' && decodeCanonicalBase64Url(value, NONCE_BYTES) !== null;
}

export function createNonce(): string {
  return randomBytes(NONCE_BYTES).toString('base64url');
}

export function bridgeProofPayload(role: BridgeAuthRole, clientNonce: string, serverNonce: string): string {
  return `${CONTEXT}\nrole=${role}\nclient=${clientNonce}\nserver=${serverNonce}`;
}

export function createBridgeProof(
  token: Uint8Array,
  role: BridgeAuthRole,
  clientNonce: string,
  serverNonce: string,
): string {
  return createHmac('sha256', token)
    .update(bridgeProofPayload(role, clientNonce, serverNonce), 'utf8')
    .digest('base64url');
}

export function verifyBridgeProof(
  token: Uint8Array,
  role: BridgeAuthRole,
  clientNonce: string,
  serverNonce: string,
  proof: unknown,
): boolean {
  if (typeof proof !== 'string') return false;
  const actual = Buffer.from(proof, 'base64url');
  const expected = Buffer.from(createBridgeProof(token, role, clientNonce, serverNonce), 'base64url');
  return actual.byteLength === expected.byteLength && timingSafeEqual(actual, expected);
}

export class NonceReplayCache {
  private readonly entries = new Map<string, number>();

  constructor(
    private readonly ttlMs = 5 * 60_000,
    private readonly maxEntries = 2_048,
    private readonly now: () => number = Date.now,
  ) {}

  reserve(nonce: string): boolean {
    const now = this.now();
    for (const [value, expiresAt] of this.entries) {
      if (expiresAt <= now) this.entries.delete(value);
    }
    if (this.entries.has(nonce)) return false;
    while (this.entries.size >= this.maxEntries) {
      const oldest = this.entries.keys().next().value as string | undefined;
      if (oldest === undefined) break;
      this.entries.delete(oldest);
    }
    this.entries.set(nonce, now + this.ttlMs);
    return true;
  }
}
