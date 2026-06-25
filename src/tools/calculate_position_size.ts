import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

export function registerCalculatePositionSize(server: McpServer): void {
  server.registerTool(
    'romaco_calculate_position_size',
    {
      description:
        'Calculate position size based on account risk management rules. ' +
        'Given account size, risk percentage, entry price, and stop loss — returns exact shares/contracts to trade, ' +
        'total risk in dollars, position value, and risk/reward ratio if target is provided. ' +
        'Pure math — no data source or browser needed.',
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
          'Take profit target. Used to calculate risk/reward ratio (optional).'
        ),
        commissionPerSide: z.number().min(0).optional().describe(
          'Commission cost per trade side in USD (default 0). Affects net P&L calculation.'
        ),
      },
    },
    async ({ accountSize, riskPct, entryPrice, stopLoss, targetPrice, commissionPerSide = 0 }) => {
      // Pure deterministic math — stays local even in Pro mode (never delegated to the gateway).
      const dollarRisk = accountSize * (riskPct / 100);
      const stopDistance = Math.abs(entryPrice - stopLoss);

      if (stopDistance === 0) {
        return {
          content: [{ type: 'text' as const, text: 'Error: entryPrice and stopLoss cannot be the same.' }],
          isError: true,
        };
      }

      const side: 'long' | 'short' = entryPrice > stopLoss ? 'long' : 'short';
      const shares = Math.floor(dollarRisk / stopDistance);
      const positionValue = shares * entryPrice;
      const actualRisk = shares * stopDistance + commissionPerSide * 2;
      const pctOfAccount = (positionValue / accountSize) * 100;

      const result: Record<string, unknown> = {
        side,
        shares,
        entryPrice,
        stopLoss,
        stopDistance,
        positionValue,
        positionPctOfAccount: pctOfAccount,
        maxDollarRisk: dollarRisk,
        actualDollarRisk: actualRisk,
        riskPctOfAccount: (actualRisk / accountSize) * 100,
      };

      if (targetPrice !== undefined) {
        const rewardDistance = Math.abs(targetPrice - entryPrice);
        const riskReward = rewardDistance / stopDistance;
        const potentialProfit = shares * rewardDistance - commissionPerSide * 2;
        result.targetPrice = targetPrice;
        result.riskRewardRatio = riskReward;
        result.potentialProfit = potentialProfit;
        result.breakevenWinratePct = (1 / (1 + riskReward)) * 100;
      }

      return { content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }] };
    }
  );
}
