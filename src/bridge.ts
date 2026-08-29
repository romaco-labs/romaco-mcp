/** @deprecated Compatibility shim. New code imports the outbound adapter or bootstrap runtime. */
import {
  WebSocketBridgeTransport,
  isAllowedOrigin as adapterAllowsOrigin,
} from './adapters/outbound/chart/WebSocketBridgeTransport.js';
import { resolveBridgeConfig } from './bootstrap/bridgeConfig.js';

export { bridge } from './bootstrap/bridgeRuntime.js';

export class RomacoBridge extends WebSocketBridgeTransport {
  constructor(port = 7399) {
    super(resolveBridgeConfig(
      { ...process.env, ROMACO_MCP_BRIDGE_AUTH: 'legacy' },
      ['node', 'romaco-mcp', '--port', String(port)],
    ));
  }
}

export function isAllowedOrigin(origin: string | undefined): boolean {
  return adapterAllowsOrigin(origin, resolveBridgeConfig(
    { ...process.env, ROMACO_MCP_BRIDGE_AUTH: 'legacy' },
    [],
  ).allowedOrigins);
}
