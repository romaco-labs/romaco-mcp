import { createHash } from 'node:crypto';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { ApplicationError } from '../../../../application/errors.js';
import type { ApprovalPort, ApprovalScope } from '../../../../application/ports/approval.js';
import type { ClearAlertsPlan, ClearAlertsUseCase } from '../../../../application/use-cases/clearAlerts.js';
import { registerCatalogContractTool } from '../catalogContractTool.js';
import type { RegisterContractToolOptions } from '../contracts.js';
import { clearAlertsDataSchema } from '../outputSchemas.js';

function planId(plan: ClearAlertsPlan): string {
  return `clear_alerts_${createHash('sha256').update(plan.fingerprint).digest('hex')}`;
}

function mapClearAlertsError(error: unknown): ApplicationError {
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
    recovery: { action: 'retry', instruction: 'Refresh chart identity and request new approval.' },
    cause: error,
  });
}

export function registerClearAlerts(
  server: McpServer,
  useCase: ClearAlertsUseCase,
  approvals: ApprovalPort,
  options: RegisterContractToolOptions = {},
): void {
  registerCatalogContractTool(
    server,
    'romaco_clear_alerts',
    {
      description:
        'Preview and remove every alert from one exact live chart after scoped, one-time approval. ' +
        'First call returns alert IDs/count and performs zero writes. Retry with returned planId and ' +
        'approvalToken. MCP removes alerts individually with expected chart identity; it never sends ' +
        'the global clearAlerts host action. A changed chart or alert plan fails closed.',
      inputSchema: z.object({
        planId: z.string().min(1).max(128).optional(),
        approvalToken: z.string().min(32).max(256).optional(),
      }),
      dataSchema: clearAlertsDataSchema,
    },
    async ({ planId: approvedPlanId, approvalToken }) => {
      try {
        const plan = await useCase.preview();
        const currentPlanId = planId(plan);
        if (approvalToken && !approvedPlanId) {
          throw new ApplicationError('APPROVAL_INVALID', 'planId is required with approvalToken.', {
            recovery: {
              action: 'request_approval',
              instruction: 'Request a fresh preview and retry with both returned fields.',
            },
          });
        }

        if (approvalToken && approvedPlanId && plan.alerts.length === 0) {
          approvals.consume(
            { action: 'romaco_clear_alerts', resourceId: approvedPlanId },
            approvalToken,
          );
          throw new ApplicationError('APPROVAL_INVALID', 'Alert-clear approval token is invalid or already consumed.', {
            recovery: {
              action: 'request_approval',
              instruction: 'Request a fresh preview before any later alert-clear operation.',
            },
          });
        }

        if (plan.alerts.length === 0) {
          return {
            status: 'noop',
            data: {
              planId: currentPlanId,
              chartId: plan.identity.chartId,
              symbol: plan.identity.symbol,
              timeframe: plan.identity.timeframe,
              alertIds: [],
              removedCount: 0,
              scope: 'current-chart-alerts' as const,
            },
            summary: `No alerts on ${plan.identity.chartId}; no chart writes performed.`,
            context: {
              chartId: plan.identity.chartId,
              symbol: plan.identity.symbol,
              timeframe: plan.identity.timeframe,
              ...(plan.identity.datasetId ? { datasetId: plan.identity.datasetId } : {}),
            },
          };
        }

        if (!approvalToken) {
          const scope: ApprovalScope = { action: 'romaco_clear_alerts', resourceId: currentPlanId };
          const challenge = approvals.issue(scope);
          throw new ApplicationError(
            'APPROVAL_REQUIRED',
            `Explicit approval required to remove ${plan.alerts.length} alert(s) from ${plan.identity.chartId}.`,
            {
              recovery: {
                action: 'request_approval',
                instruction: 'Show this exact alert preview to the user, then retry with planId and approvalToken.',
                parameters: {
                  planId: currentPlanId,
                  approvalToken: challenge.token,
                  expiresAt: challenge.expiresAt,
                  chartId: plan.identity.chartId,
                  symbol: plan.identity.symbol,
                  timeframe: plan.identity.timeframe,
                  alerts: plan.alerts.map((alert) => ({ ...alert })),
                  alertCount: plan.alerts.length,
                  scope: 'current-chart-alerts',
                },
              },
            },
          );
        }
        if (!approvedPlanId) {
          throw new ApplicationError('APPROVAL_INVALID', 'planId is required with approvalToken.', {
            recovery: {
              action: 'request_approval',
              instruction: 'Request a fresh preview and retry with both returned fields.',
            },
          });
        }
        const approval = approvals.consume(
          { action: 'romaco_clear_alerts', resourceId: approvedPlanId },
          approvalToken,
        );
        if (approval !== 'approved' || approvedPlanId !== currentPlanId) {
          throw new ApplicationError(
            'APPROVAL_INVALID',
            `Alert-clear approval is ${approval === 'approved' ? 'stale' : approval}.`,
            {
              recovery: {
                action: 'request_approval',
                instruction: 'Request a new preview and approval for current chart alerts.',
              },
            },
          );
        }

        const result = await useCase.apply(plan);
        return {
          status: result.removedCount === 0 ? 'noop' : 'ok',
          data: {
            planId: currentPlanId,
            chartId: result.identity.chartId,
            symbol: result.identity.symbol,
            timeframe: result.identity.timeframe,
            alertIds: [...result.removedAlertIds],
            removedCount: result.removedCount,
            scope: 'current-chart-alerts' as const,
          },
          summary: `Removed ${result.removedCount} approved alert(s) from ${result.identity.chartId}.`,
          context: {
            chartId: result.identity.chartId,
            symbol: result.identity.symbol,
            timeframe: result.identity.timeframe,
            ...(result.identity.datasetId ? { datasetId: result.identity.datasetId } : {}),
          },
        };
      } catch (error) {
        throw mapClearAlertsError(error);
      }
    },
    options,
  );
}
