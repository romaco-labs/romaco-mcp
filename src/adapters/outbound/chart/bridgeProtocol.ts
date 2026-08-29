import type { WebSocket } from 'ws';

export const BRIDGE_PROTOCOL_VERSION = 2 as const;

export interface ActionResult {
  success: boolean;
  error?: string;
  data?: unknown;
}

export interface McpDrawingStyle {
  color?: string;
  lineWidth?: number;
  lineStyle?: 'solid' | 'dashed' | 'dotted';
  opacity?: number;
  fillColor?: string;
}

export interface McpDrawingPoint {
  timestamp: number;
  price: number;
}

export interface BridgeAddDrawingAction {
  action: 'addDrawing';
  drawingType: string;
  points: McpDrawingPoint[];
  label?: string;
  style?: McpDrawingStyle;
  paneId?: string;
  groupId?: string;
}

export type BridgeAgentDrawingInput = Omit<BridgeAddDrawingAction, 'action' | 'groupId'>;

export interface BridgeExpectedIdentity {
  chartId: string;
  symbol: string;
  resolution: string;
}

type WithExpectedIdentity<T> = T extends unknown
  ? T & { expectedIdentity?: BridgeExpectedIdentity }
  : never;

type BridgeActionPayload =
  | { action: 'addIndicator'; indicatorType: string; params?: number[] }
  | BridgeAddDrawingAction
  | { action: 'zoomIn'; factor?: number }
  | { action: 'zoomOut'; factor?: number }
  | { action: 'resetView' }
  | { action: 'addAlert'; price: number; options?: { direction?: 'above' | 'below' | 'cross'; note?: string } }
  | { action: 'clearDrawings' }
  | { action: 'removeDrawingsByGroup'; groupId: string }
  | { action: 'replaceAgentDrawingGroup'; groupId: string; idempotencyKey: string; drawings: BridgeAgentDrawingInput[] }
  | { action: 'openPaperLong'; quantity: number; stopLoss?: number; takeProfit?: number }
  | { action: 'openPaperShort'; quantity: number; stopLoss?: number; takeProfit?: number }
  | { action: 'getIndicatorValues'; indicatorId?: string; indicatorName?: string }
  | { action: 'goToTimestamp'; timestamp: number }
  | { action: 'listPanes' }
  | { action: 'removeAlert'; alertId: string }
  | { action: 'clearAlerts' }
  | { action: 'removeIndicator'; indicatorId: string }
  | { action: 'setPriceRange'; min: number; max: number };

export type BridgeAction = WithExpectedIdentity<BridgeActionPayload>;
export type BridgeAuthMode = 'required' | 'legacy';
export type BridgeAuthRole = 'server' | 'client';

export interface BridgeTransportConfig {
  port: number;
  authMode: BridgeAuthMode;
  token: Uint8Array | null;
  enabled: boolean;
  disabledReason?: string;
  allowedOrigins: ReadonlySet<string>;
  authTimeoutMs: number;
}

export type BridgeServerMessage =
  | { type: 'bridge_challenge'; protocolVersion: 2; clientNonce: string; serverNonce: string; serverProof: string }
  | { type: 'bridge_authenticated'; protocolVersion: 2 }
  | { type: 'ping' }
  | { type: 'execute_action'; requestId: string; action: BridgeAction }
  | { type: 'get_context'; requestId: string; includeCandles: boolean }
  | { type: 'capture_snapshot'; requestId: string; format: 'png' | 'jpeg' };

export type BridgeClientMessage =
  | { type: 'bridge_hello'; supportedVersions: number[]; clientNonce: string }
  | { type: 'bridge_authenticate'; protocolVersion: 2; clientNonce: string; serverNonce: string; clientProof: string }
  | { type: 'ready'; protocolVersion?: 2; chartId: string }
  | { type: 'action_result'; requestId: string; result: ActionResult }
  | { type: 'context_result'; requestId: string; context: unknown }
  | { type: 'snapshot_result'; requestId: string; dataUrl: string }
  | { type: 'error'; requestId: string; error: string; code?: string };

export interface PendingRequest {
  resolve: (value: unknown) => void;
  reject: (reason: Error) => void;
  timer: ReturnType<typeof setTimeout>;
  socket: WebSocket;
}
