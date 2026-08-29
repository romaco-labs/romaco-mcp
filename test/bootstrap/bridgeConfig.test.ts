import { describe, expect, it } from 'vitest';
import { normalizeOrigin, resolveBridgeConfig } from '../../src/bootstrap/bridgeConfig.js';
import { RomacoBridge } from '../../src/bridge.js';

const TOKEN = 'AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8';

describe('bridge config', () => {
  it('auto selects required when a valid pairing token exists', () => {
    const config = resolveBridgeConfig({ ROMACO_MCP_BRIDGE_TOKEN: TOKEN }, []);
    expect(config).toMatchObject({ enabled: true, authMode: 'required' });
    expect(config.token).toHaveLength(32);
  });

  it('auto selects legacy only when token is absent', () => {
    expect(resolveBridgeConfig({}, [])).toMatchObject({ enabled: true, authMode: 'legacy', token: null });
  });

  it('disables bridge for required mode without a token', () => {
    expect(resolveBridgeConfig({ ROMACO_MCP_BRIDGE_AUTH: 'required' }, [])).toMatchObject({
      enabled: false,
      authMode: 'required',
    });
  });

  it('fails closed when a configured token or mode is invalid', () => {
    expect(resolveBridgeConfig({ ROMACO_MCP_BRIDGE_TOKEN: 'bad' }, []).enabled).toBe(false);
    expect(resolveBridgeConfig({ ROMACO_MCP_BRIDGE_AUTH: 'wat' }, []).enabled).toBe(false);
  });

  it('never downgrades auto with a malformed configured token', () => {
    const config = resolveBridgeConfig({ ROMACO_MCP_BRIDGE_AUTH: 'auto', ROMACO_MCP_BRIDGE_TOKEN: 'bad' }, []);
    expect(config).toMatchObject({ enabled: false, authMode: 'required' });
  });

  it('keeps paired env config through the compatibility constructor', () => {
    const previousAuth = process.env.ROMACO_MCP_BRIDGE_AUTH;
    const previousToken = process.env.ROMACO_MCP_BRIDGE_TOKEN;
    try {
      process.env.ROMACO_MCP_BRIDGE_AUTH = 'auto';
      process.env.ROMACO_MCP_BRIDGE_TOKEN = TOKEN;
      const bridge = new RomacoBridge(17_499) as unknown as {
        config: { authMode: string; token: Uint8Array | null };
      };
      expect(bridge.config.authMode).toBe('required');
      expect(bridge.config.token).toHaveLength(32);
    } finally {
      if (previousAuth === undefined) delete process.env.ROMACO_MCP_BRIDGE_AUTH;
      else process.env.ROMACO_MCP_BRIDGE_AUTH = previousAuth;
      if (previousToken === undefined) delete process.env.ROMACO_MCP_BRIDGE_TOKEN;
      else process.env.ROMACO_MCP_BRIDGE_TOKEN = previousToken;
    }
  });

  it('accepts only exact HTTP(S) origins', () => {
    expect(normalizeOrigin('https://chart.example.com')).toBe('https://chart.example.com');
    expect(normalizeOrigin('https://chart.example.com/')).toBe('https://chart.example.com');
    expect(normalizeOrigin('https://chart.example.com/path')).toBeNull();
    expect(normalizeOrigin('ws://chart.example.com')).toBeNull();

    const config = resolveBridgeConfig({
      ROMACO_MCP_ALLOWED_ORIGINS: 'https://chart.example.com,https://bad.example/path',
    }, []);
    expect(config.allowedOrigins.has('https://chart.example.com')).toBe(true);
    expect(config.allowedOrigins.has('https://bad.example')).toBe(false);
    expect(config.allowedOrigins.has('https://romaco.io')).toBe(true);
    expect(config.allowedOrigins.has('https://www.romaco.io')).toBe(false);
  });
});
