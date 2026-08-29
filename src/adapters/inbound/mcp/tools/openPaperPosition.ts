import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { ApplicationError } from '../../../../application/errors.js';
import type { ApprovalPort, ApprovalScope } from '../../../../application/ports/approval.js';
import type { OpenPaperPositionUseCase } from '../../../../application/use-cases/openPaperPosition.js';
import { registerCatalogContractTool } from '../catalogContractTool.js';
import type { RegisterContractToolOptions } from '../contracts.js';
import { openPaperPositionDataSchema } from '../outputSchemas.js';

function mapPaperError(error: unknown): ApplicationError {
  if (error instanceof ApplicationError) return error;
  const message = error instanceof Error ? error.message : String(error);
  if (/no chart|not connected|mcpbridge|identity announced/i.test(message)) {
    return new ApplicationError('CHART_NOT_CONNECTED', message, {
      retryable: true,
      recovery: { action: 'connect_chart', instruction: 'Connect a paired chart and retry.' },
      cause: error,
    });
  }
  return new ApplicationError('ACTION_DENIED', message, {
    retryable: true,
    recovery: { action: 'retry', instruction: 'Refresh chart identity and request a new approval.' },
    cause: error,
  });
}

export function registerOpenPaperPosition(
  server: McpServer,
  useCase: OpenPaperPositionUseCase,
  approvals: ApprovalPort,
  options: RegisterContractToolOptions = {},
): void {
  registerCatalogContractTool(
    server,
    'romaco_open_paper_position',
    {
      description:
        'Open a simulated paper position on the exact live chart; never routes a real order or money. ' +
        'Requires caller-supplied idempotencyKey and one-time approval token scoped to full payload and ' +
        'chart identity. First call returns a challenge with zero chart writes. Exact completed retries ' +
        'return the stored receipt; same key with changed payload fails with IDEMPOTENCY_CONFLICT.',
      inputSchema: z.object({
        side: z.enum(['long', 'short']),
        quantity: z.number().finite().positive(),
        stopLoss: z.number().finite().positive().optional(),
        takeProfit: z.number().finite().positive().optional(),
        idempotencyKey: z.string().trim().min(1).max(128),
        approvalToken: z.string().min(32).max(256).optional(),
      }),
      dataSchema: openPaperPositionDataSchema,
    },
    async ({ side, quantity, stopLoss, takeProfit, idempotencyKey, approvalToken }) => {
      try {
        const prepared = await useCase.prepare({
          side,
          quantity,
          ...(stopLoss === undefined ? {} : { stopLoss }),
          ...(takeProfit === undefined ? {} : { takeProfit }),
          idempotencyKey,
        });
        if (prepared.kind === 'replay') {
          const receipt = prepared.receipt;
          return {
            status: 'noop',
            data: {
              chartId: receipt.chartIdentity.chartId,
              symbol: receipt.chartIdentity.symbol!,
              timeframe: receipt.chartIdentity.timeframe!,
              position: {
                mode: 'paper' as const,
                side: receipt.side,
                quantity: receipt.quantity,
                ...(receipt.stopLoss === undefined ? {} : { stopLoss: receipt.stopLoss }),
                ...(receipt.takeProfit === undefined ? {} : { takeProfit: receipt.takeProfit }),
                ...(receipt.hostPositionId ? { hostPositionId: receipt.hostPositionId } : {}),
              },
              idempotencyKey: receipt.idempotencyKey,
              replayed: true,
            },
            summary: `Replayed completed paper ${receipt.side} receipt; no new position opened.`,
            context: {
              chartId: receipt.chartIdentity.chartId,
              symbol: receipt.chartIdentity.symbol,
              timeframe: receipt.chartIdentity.timeframe,
              ...(receipt.chartIdentity.datasetId ? { datasetId: receipt.chartIdentity.datasetId } : {}),
            },
          };
        }

        const scope: ApprovalScope = {
          action: 'romaco_open_paper_position',
          resourceId: prepared.approvalResourceId,
        };
        if (!approvalToken) {
          const challenge = approvals.issue(scope);
          throw new ApplicationError('APPROVAL_REQUIRED', 'Explicit approval required before paper position.', {
            recovery: {
              action: 'request_approval',
              instruction: 'Show exact simulated position and chart identity to user, then retry with approvalToken.',
              parameters: {
                approvalToken: challenge.token,
                expiresAt: challenge.expiresAt,
                idempotencyKey,
                chartId: prepared.identity.chartId,
                symbol: prepared.identity.symbol!,
                timeframe: prepared.identity.timeframe!,
                mode: 'paper',
                side,
                quantity,
                ...(stopLoss === undefined ? {} : { stopLoss }),
                ...(takeProfit === undefined ? {} : { takeProfit }),
              },
            },
          });
        }
        const approval = approvals.consume(scope, approvalToken);
        if (approval !== 'approved') {
          throw new ApplicationError('APPROVAL_INVALID', `Paper-position approval token is ${approval}.`, {
            recovery: {
              action: 'request_approval',
              instruction: 'Request a new approval for this exact idempotencyKey, payload, and chart identity.',
            },
          });
        }

        const applied = await useCase.execute(prepared);
        const receipt = applied.receipt;
        return {
          status: applied.replayed ? 'noop' : 'ok',
          data: {
            chartId: receipt.chartIdentity.chartId,
            symbol: receipt.chartIdentity.symbol!,
            timeframe: receipt.chartIdentity.timeframe!,
            position: {
              mode: 'paper' as const,
              side: receipt.side,
              quantity: receipt.quantity,
              ...(receipt.stopLoss === undefined ? {} : { stopLoss: receipt.stopLoss }),
              ...(receipt.takeProfit === undefined ? {} : { takeProfit: receipt.takeProfit }),
              ...(receipt.hostPositionId ? { hostPositionId: receipt.hostPositionId } : {}),
            },
            idempotencyKey: receipt.idempotencyKey,
            replayed: applied.replayed,
          },
          summary:
            `${applied.replayed ? 'Replayed' : 'Opened'} paper ${receipt.side}: ${receipt.quantity} unit(s). ` +
            'No real order or money involved.',
          context: {
            chartId: receipt.chartIdentity.chartId,
            symbol: receipt.chartIdentity.symbol,
            timeframe: receipt.chartIdentity.timeframe,
            ...(receipt.chartIdentity.datasetId ? { datasetId: receipt.chartIdentity.datasetId } : {}),
          },
        };
      } catch (error) {
        throw mapPaperError(error);
      }
    },
    options,
  );
}

