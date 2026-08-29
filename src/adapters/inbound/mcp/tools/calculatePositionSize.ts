import { createHash } from 'node:crypto';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { ApplicationError } from '../../../../application/errors.js';
import { CalculatePositionSizeUseCase } from '../../../../application/use-cases/calculatePositionSize.js';
import { PositionSizeError } from '../../../../domain/risk/calculatePositionSize.js';
import { registerCatalogContractTool } from '../catalogContractTool.js';
import type { RegisterContractToolOptions } from '../contracts.js';
import { positionSizeDataSchema } from '../outputSchemas.js';

export function registerCalculatePositionSize(
  server: McpServer,
  useCase = new CalculatePositionSizeUseCase(),
  options: RegisterContractToolOptions = {},
): void {
  registerCatalogContractTool(
    server,
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
      inputSchema: z.object({
        accountSize: z.number().finite().positive().describe('Total account value in USD (e.g., 10000)'),
        riskPct: z.number().finite().min(0.1).max(10).describe(
          'Max risk as percentage of account. Recommended: 0.5–2%.',
        ),
        entryPrice: z.number().finite().positive().describe('Planned entry price per share/unit'),
        stopLoss: z.number().finite().positive().describe(
          'Stop loss price. Must be below entry for longs, above for shorts.',
        ),
        targetPrice: z.number().finite().positive().optional().describe(
          'Take profit target. Must be above entry for longs or below entry for shorts.',
        ),
        commissionPerSide: z.number().finite().min(0).optional().describe(
          'Fixed commission per trade side in USD. Round-trip commission counts toward max risk.',
        ),
      }),
      dataSchema: positionSizeDataSchema,
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
        const calculationId = `calculation_${createHash('sha256')
          .update(JSON.stringify({ accountSize, riskPct, entryPrice, stopLoss, targetPrice, commissionPerSide }))
          .digest('hex')
          .slice(0, 20)}`;
        return {
          data: { calculationId, ...result },
          // Preserve v0.x human/text contract for existing MCP clients.
          summary: JSON.stringify(result, null, 2),
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        throw new ApplicationError('INVALID_ARGUMENT', `Error: ${message}`, {
          recovery: {
            action: 'change_input',
            instruction: error instanceof PositionSizeError && error.code === 'target_wrong_side'
              ? 'Move targetPrice to the profitable side of entryPrice.'
              : 'Correct the position-sizing inputs and retry.',
          },
          cause: error,
        });
      }
    },
    options,
  );
}
