import { WebSocketBridgeTransport } from '../adapters/outbound/chart/WebSocketBridgeTransport.js';
import { resolveBridgeConfig } from './bridgeConfig.js';

export const bridge = new WebSocketBridgeTransport(resolveBridgeConfig());
