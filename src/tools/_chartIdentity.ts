import { bridge } from '../bridge.js';
import { mapChartIdentity } from '../adapters/outbound/chart/mapChartContext.js';
import type { ChartIdentity } from '../domain/chart/model.js';
import type { BridgeExpectedIdentity } from '../types.js';

/** Read and require complete live identity before a legacy tool mutates chart state. */
export async function requireLiveChartIdentity(): Promise<ChartIdentity> {
  const chartId = bridge.chartId;
  if (!chartId) throw new Error('No chart identity announced. Wait for McpBridge ready.');
  const identity = mapChartIdentity(chartId, await bridge.getContext(false));
  if (!identity.symbol || !identity.timeframe) {
    throw new Error('Live chart identity requires symbol and timeframe.');
  }
  return identity;
}

export function toBridgeExpectedIdentity(identity: ChartIdentity): BridgeExpectedIdentity {
  if (!identity.symbol || !identity.timeframe) {
    throw new Error('Live chart identity requires symbol and timeframe.');
  }
  return {
    chartId: identity.chartId,
    symbol: identity.symbol,
    resolution: identity.timeframe,
  };
}
