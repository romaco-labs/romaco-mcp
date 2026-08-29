import { describe, expect, it } from 'vitest';
import { normalizeOrigin, resolveBridgeConfig } from '../../src/bootstrap/bridgeConfig.js';

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
  });
});
