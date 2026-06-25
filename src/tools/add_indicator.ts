import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { bridge } from '../bridge.js';
import { enrichBridgeResult } from './_guards.js';
import { chartState } from '../chartState.js';
import { session } from '../session.js';

export function registerAddIndicator(server: McpServer): void {
  server.registerTool(
    'romaco_add_indicator',
    {
      description:
        'Add a technical indicator to the chart. Examples: EMA with period 20, RSI with period 14, MACD with params [12, 26, 9], BOLL (Bollinger Bands) with period 20. Params are positional numbers specific to each indicator type.',
      inputSchema: {
        indicatorType: z.string().describe(
          'Indicator type name. Common values: EMA, SMA, RSI, MACD, BOLL, KDJ, ATR, VOL, WR, BIAS, CCI, DMI, SAR, TRIX, MTM, EMV, ROC, PVT, OBV, CR, DMA, VR, BBI, AO, PSY, BRAR. Case-insensitive.'
        ),
        params: z
          .array(z.number())
          .optional()
          .describe(
            'Positional parameters. EMA/SMA: [period]. RSI: [period]. MACD: [short, long, signal]. BOLL: [period, multiplier]. KDJ: [period, k, d]. Omit to use defaults.'
          ),
      },
    },
    async ({ indicatorType, params }) => {
      const result = await bridge.executeAction({ action: 'addIndicator', indicatorType, params });
      if (result.success) {
        chartState.recordIndicator(
          { action: 'addIndicator', indicatorType, params },
          session.getLastLoad()?.symbol ?? null,
        );
        const label = params ? `${indicatorType}(${params.join(', ')})` : indicatorType;
        return { content: [{ type: 'text' as const, text: `${label} added to chart` }] };
      }
      const { text, isError } = enrichBridgeResult('romaco_add_indicator', result);
      return { content: [{ type: 'text' as const, text }], isError };
    }
  );
}
