import type { ActionResult } from '../types.js';

const SETUP_GUIDANCE =
  'Steps to fix:\n' +
  '  1. Call romaco_setup_chart with symbol+timeframe (loads data + applies a preset), OR\n' +
  '  2. Call romaco_load_candles to populate session data, then re-call this tool.\n' +
  'For chart-bridge tools, also ensure <McpBridge /> is mounted in the browser app.';

// Heuristic substrings that indicate "the chart is missing or not ready".
// Browser-side errors are not standardized, so we match on common phrases.
const CHART_MISSING_HINTS = [
  'Chart not ready',
  'chart not connected',
  'chart not loaded',
  'No chart',
  'No candle data',
  'no data loaded',
  'Indicator not found',
];

export interface NormalizedResult {
  text: string;
  isError: boolean;
}

/**
 * Normalizes a chart-bridge ActionResult into MCP-friendly { text, isError }.
 * When the bridge returned an error matching a "chart missing" hint, the message
 * is enriched with explicit setup guidance so the LLM knows exactly what to call.
 * Success values are stringified compactly (already-string passes through as-is).
 */
export function enrichBridgeResult(toolName: string, result: ActionResult): NormalizedResult {
  if (result.success) {
    if (result.data == null) return { text: '', isError: false };
    return {
      text: typeof result.data === 'string' ? result.data : JSON.stringify(result.data, null, 2),
      isError: false,
    };
  }
  const err = result.error ?? 'unknown error';
  const needsGuidance = CHART_MISSING_HINTS.some((h) =>
    err.toLowerCase().includes(h.toLowerCase()),
  );
  return {
    text: needsGuidance ? `${toolName}: ${err}\n\n${SETUP_GUIDANCE}` : `${toolName} failed: ${err}`,
    isError: true,
  };
}
