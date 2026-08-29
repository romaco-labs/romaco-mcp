import { describe, expect, it } from 'vitest';
import {
  createBridgeProof,
  createNonce,
  isCanonicalNonce,
  NonceReplayCache,
  parsePairingToken,
  verifyBridgeProof,
} from '../../../src/adapters/outbound/chart/bridgeAuth.js';

const TOKEN = 'AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8';
const CLIENT_NONCE = 'ICEiIyQlJicoKSorLC0uLzAxMjM0NTY3ODk6Ozw9Pj8';
const SERVER_NONCE = 'QEFCQ0RFRkdISUpLTE1OT1BRUlNUVVZXWFlaW1xdXl8';

describe('bridge auth v2', () => {
  it('matches the shared Node/WebCrypto interoperability vector', () => {
    const token = parsePairingToken(TOKEN)!;
    expect(createBridgeProof(token, 'server', CLIENT_NONCE, SERVER_NONCE)).toBe(
      'qv9TzpCsC2Ki8IBDa811CQ56NiCeR76XL5khPpVOF38',
    );
    expect(createBridgeProof(token, 'client', CLIENT_NONCE, SERVER_NONCE)).toBe(
      'eSSyrGqO2-rl81b0t3lTw_clLjDM0roVvOuGZOZHH4A',
    );
  });

  it('separates server and client roles and verifies in constant time', () => {
    const token = parsePairingToken(TOKEN)!;
    const serverProof = createBridgeProof(token, 'server', CLIENT_NONCE, SERVER_NONCE);
    expect(verifyBridgeProof(token, 'server', CLIENT_NONCE, SERVER_NONCE, serverProof)).toBe(true);
    expect(verifyBridgeProof(token, 'client', CLIENT_NONCE, SERVER_NONCE, serverProof)).toBe(false);
    expect(verifyBridgeProof(token, 'server', CLIENT_NONCE, SERVER_NONCE, `${serverProof}=`)).toBe(false);
    expect(verifyBridgeProof(token, 'server', CLIENT_NONCE, SERVER_NONCE, 'x'.repeat(100_000))).toBe(false);
  });

  it('requires canonical 32-byte base64url tokens and nonces', () => {
    expect(parsePairingToken(TOKEN)).toHaveLength(32);
    expect(parsePairingToken(`${TOKEN}=`)).toBeNull();
    expect(parsePairingToken('short')).toBeNull();
    expect(isCanonicalNonce(createNonce())).toBe(true);
    expect(isCanonicalNonce(`${CLIENT_NONCE}=`)).toBe(false);
  });

  it('rejects nonce replay until TTL expires', () => {
    let now = 1_000;
    const cache = new NonceReplayCache(100, 2, () => now);
    expect(cache.reserve(CLIENT_NONCE)).toBe(true);
    expect(cache.reserve(CLIENT_NONCE)).toBe(false);
    now += 101;
    expect(cache.reserve(CLIENT_NONCE)).toBe(true);
  });
});
