// Bridge protocol types — messages between @romaco/mcp server and the browser chart.

export interface ActionResult {
  success: boolean;
  error?: string;
  data?: unknown;
}

// Style accepted by the MCP add_drawing tool. Flat shape — the browser-side
// ChartAgentController maps it into the chart's nested DrawingStyle.
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

// Subset of ChartAction shapes the MCP server constructs and sends to the
// browser. The browser executes them via ChartAgentController.executeAction().
export type BridgeAction =
  | { action: 'addIndicator'; indicatorType: string; params?: number[] }
  | {
      action: 'addDrawing';
      drawingType: string;
      points: McpDrawingPoint[];
      label?: string;
      style?: McpDrawingStyle;
      paneId?: string;
      groupId?: string;
    }
  | { action: 'zoomIn'; factor?: number }
  | { action: 'zoomOut'; factor?: number }
  | { action: 'resetView' }
  | { action: 'addAlert'; price: number; options?: { direction?: 'above' | 'below' | 'cross'; note?: string } }
  | { action: 'clearDrawings' }
  | { action: 'removeDrawingsByGroup'; groupId: string }
  | { action: 'openPaperLong'; quantity: number; stopLoss?: number; takeProfit?: number }
  | { action: 'openPaperShort'; quantity: number; stopLoss?: number; takeProfit?: number }
  | { action: 'getIndicatorValues'; indicatorId?: string; indicatorName?: string }
  | { action: 'goToTimestamp'; timestamp: number }
  | { action: 'listPanes' }
  | { action: 'removeAlert'; price: number; direction?: 'above' | 'below' | 'cross' }
  | { action: 'clearAlerts' }
  | { action: 'removeIndicator'; indicatorType: string }
  | { action: 'setPriceRange'; min: number; max: number };

// MCP server → Browser
export type BridgeServerMessage =
  | { type: 'ping' }
  | { type: 'execute_action'; requestId: string; action: BridgeAction }
  | { type: 'get_context'; requestId: string; includeCandles: boolean }
  | { type: 'capture_snapshot'; requestId: string; format: 'png' | 'jpeg' };

// Browser → MCP server
export type BridgeClientMessage =
  | { type: 'ready'; chartId: string }
  | { type: 'action_result'; requestId: string; result: ActionResult }
  | { type: 'context_result'; requestId: string; context: unknown }
  | { type: 'snapshot_result'; requestId: string; dataUrl: string }
  | { type: 'error'; requestId: string; error: string };

export interface PendingRequest {
  resolve: (value: unknown) => void;
  reject: (reason: Error) => void;
  timer: ReturnType<typeof setTimeout>;
  socket: import('ws').WebSocket;
}
