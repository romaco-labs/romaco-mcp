import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { CalculatePositionSizeUseCase } from '../../../../application/use-cases/calculatePositionSize.js';

export function registerCalculatePositionSize(
  server: McpServer,
  useCase = new CalculatePositionSizeUseCase(),
): void {
  server.registerTool(
    'romaco_calculate_position_size',
    {
      description:
        'Calculate position size based on account risk management rules. ' +
        'Given account size, risk percentage, entry price, and stop loss — returns exact shares/contracts to trade, ' +
        'total risk in dollars, position value, and risk/reward ratio if target is provided. ' +
        'Round-trip commission is reserved inside the risk budget before sizing. ' +
        'riskRewardRatio and breakevenWinratePct remain gross for compatibility; grossRiskRewardRatio, ' +
        'netRiskRewardRatio, and netBreakevenWinratePct make commission treatment explicit. ' +
        'Targets on the losing side of the entry are rejected. Pure math — no data source or browser needed.',
      inputSchema: {
        accountSize: z.number().positive().describe('Total account value in USD (e.g., 10000)'),
        riskPct: z.number().min(0.1).max(10).describe(
          'Max risk as percentage of account (e.g., 1 = risk 1% = $100 on a $10,000 account). Recommended: 0.5–2%.'
        ),
        entryPrice: z.number().positive().describe('Planned entry price per share/unit'),
        stopLoss: z.number().positive().describe(
          'Stop loss price. Must be below entry for longs, above for shorts.'
        ),
        targetPrice: z.number().positive().optional().describe(
          'Take profit target. Must be above entry for longs or below entry for shorts.'
        ),
        commissionPerSide: z.number().min(0).optional().describe(
          'Fixed commission per trade side in USD (default 0). Round-trip commission counts toward max risk.'
        ),
      },
    },
    async ({ accountSize, riskPct, entryPrice, stopLoss, targetPrice, commissionPerSide = 0 }) => {
      try {
        const result = useCase.execute({
          accountSize,
          riskPct,
          entryPrice,
          stopLoss,
          targetPrice,
          commissionPerSide,
        });
        return { content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }] };
      } catch (err) {
        return {
          content: [{
            type: 'text' as const,
            text: `Error: ${err instanceof Error ? err.message : String(err)}`,
          }],
          isError: true,
        };
      }
    },
  );
}
