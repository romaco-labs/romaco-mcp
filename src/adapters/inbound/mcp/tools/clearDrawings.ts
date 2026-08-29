import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { ApplicationError } from '../../../../application/errors.js';
import type { ApprovalPort, ApprovalScope } from '../../../../application/ports/approval.js';
import type { ClearAgentDrawingsUseCase } from '../../../../application/use-cases/clearAgentDrawings.js';
import { registerCatalogContractTool } from '../catalogContractTool.js';
import type { RegisterContractToolOptions } from '../contracts.js';
import { clearDrawingsDataSchema } from '../outputSchemas.js';

function mapClearError(error: unknown): ApplicationError {
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

export function registerClearDrawings(
  server: McpServer,
  useCase: ClearAgentDrawingsUseCase,
  approvals: ApprovalPort,
  options: RegisterContractToolOptions = {},
): void {
  registerCatalogContractTool(
    server,
    'romaco_clear_drawings',
    {
      description:
        'Remove only Romaco-managed drawing groups (`romaco-mcp/*`) from the exact live chart. ' +
        'User drawings and non-Romaco groups are never touched. First call previews exact scope, ' +
        'returns a one-time approval challenge, and performs zero writes. Retry with returned ' +
        'planId and approvalToken. A changed chart or group plan fails closed.',
      inputSchema: z.object({
        planId: z.string().min(1).max(2_048).optional(),
        approvalToken: z.string().min(32).max(256).optional(),
      }),
      dataSchema: clearDrawingsDataSchema,
    },
    async ({ planId, approvalToken }) => {
      try {
        const plan = await useCase.preview();
        if (approvalToken && !planId) {
          throw new ApplicationError('APPROVAL_INVALID', 'planId is required with approvalToken.', {
            recovery: {
              action: 'request_approval',
              instruction: 'Request a fresh preview and retry with both returned fields.',
            },
          });
        }
        // A consumed token must not become an apparent successful no-op after
        // its approved groups were removed. Reject replay before empty-plan exit.
        if (approvalToken && planId && plan.groups.length === 0) {
          approvals.consume(
            { action: 'romaco_clear_drawings', resourceId: planId },
            approvalToken,
          );
          throw new ApplicationError('APPROVAL_INVALID', 'Drawing-clear approval token is invalid or already consumed.', {
            recovery: {
              action: 'request_approval',
              instruction: 'Request a fresh preview before any later drawing-clear operation.',
            },
          });
        }
        if (plan.groups.length === 0) {
          return {
            status: 'noop',
            data: {
              planId: plan.planId,
              chartId: plan.identity.chartId,
              symbol: plan.identity.symbol,
              timeframe: plan.identity.timeframe,
              groupIds: [],
              removedCount: 0,
              scope: 'romaco-agent-groups' as const,
            },
            summary: `No Romaco-managed drawing groups on ${plan.identity.chartId}; user drawings unchanged.`,
            context: {
              chartId: plan.identity.chartId,
              symbol: plan.identity.symbol,
              timeframe: plan.identity.timeframe,
              ...(plan.identity.datasetId ? { datasetId: plan.identity.datasetId } : {}),
            },
          };
        }

        if (!approvalToken) {
          const scope: ApprovalScope = { action: 'romaco_clear_drawings', resourceId: plan.planId };
          const challenge = approvals.issue(scope);
          throw new ApplicationError(
            'APPROVAL_REQUIRED',
            `Explicit approval required to remove ${plan.drawingCount} Romaco drawing(s) from ${plan.groups.length} group(s).`,
            {
              recovery: {
                action: 'request_approval',
                instruction: 'Show this exact preview to the user, then retry with planId and approvalToken.',
                parameters: {
                  planId: plan.planId,
                  approvalToken: challenge.token,
                  expiresAt: challenge.expiresAt,
                  chartId: plan.identity.chartId,
                  symbol: plan.identity.symbol,
                  timeframe: plan.identity.timeframe,
                  groupIds: plan.groups.map((group) => group.groupId),
                  drawingCount: plan.drawingCount,
                  scope: 'romaco-agent-groups',
                },
              },
            },
          );
        }
        if (!planId) {
          throw new ApplicationError('APPROVAL_INVALID', 'planId is required with approvalToken.', {
            recovery: {
              action: 'request_approval',
              instruction: 'Request a fresh preview and retry with both returned fields.',
            },
          });
        }
        const approval = approvals.consume(
          { action: 'romaco_clear_drawings', resourceId: planId },
          approvalToken,
        );
        if (approval !== 'approved' || planId !== plan.planId) {
          throw new ApplicationError('APPROVAL_INVALID', `Drawing-clear approval is ${approval === 'approved' ? 'stale' : approval}.`, {
            recovery: {
              action: 'request_approval',
              instruction: 'Request a new preview and approval for current chart groups.',
            },
          });
        }

        const result = await useCase.apply(plan);
        return {
          status: result.removedGroupIds.length === 0 ? 'noop' : 'ok',
          data: {
            planId: result.planId,
            chartId: result.identity.chartId,
            symbol: result.identity.symbol,
            timeframe: result.identity.timeframe,
            groupIds: [...result.removedGroupIds],
            removedCount: result.removedCount,
            scope: 'romaco-agent-groups' as const,
          },
          summary:
            `Removed ${result.removedCount} Romaco-managed drawing(s) from ${result.removedGroupIds.length} group(s); ` +
            'user drawings unchanged.',
          context: {
            chartId: result.identity.chartId,
            symbol: result.identity.symbol,
            timeframe: result.identity.timeframe,
            ...(result.identity.datasetId ? { datasetId: result.identity.datasetId } : {}),
          },
        };
      } catch (error) {
        throw mapClearError(error);
      }
    },
    options,
  );
}
