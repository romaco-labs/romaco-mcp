import { ApplicationError } from '../errors.js';
import type { ChartPort } from '../ports/chart.js';
import type { ChartDesiredStatePort } from '../ports/chartDesiredState.js';
import type { ChartIdentity } from '../../domain/chart/model.js';

export interface ClearableAlert {
  alertId: string;
  price: number;
  direction: 'above' | 'below' | 'cross';
}

export interface ClearAlertsPlan {
  identity: ChartIdentity & {
    symbol: string;
    timeframe: NonNullable<ChartIdentity['timeframe']>;
  };
  alerts: readonly ClearableAlert[];
  fingerprint: string;
}

export interface ClearAlertsResult extends ClearAlertsPlan {
  removedAlertIds: readonly string[];
  removedCount: number;
}

function exactIdentity(identity: ChartIdentity): ClearAlertsPlan['identity'] {
  if (!identity.symbol || !identity.timeframe) {
    throw new ApplicationError(
      'CHART_NOT_READY',
      'Clearing alerts requires exact chartId, symbol, and timeframe identity.',
      {
        retryable: true,
        recovery: {
          action: 'connect_chart',
          instruction: 'Load a symbol and timeframe in the paired chart, then retry.',
        },
      },
    );
  }
  return { ...identity, symbol: identity.symbol, timeframe: identity.timeframe };
}

function part(value: string | number | undefined): string {
  const text = value === undefined ? '' : String(value);
  return `${text.length}:${text}`;
}

function planFingerprint(
  identity: ClearAlertsPlan['identity'],
  alerts: readonly ClearableAlert[],
): string {
  return [
    'clear-alerts-v1',
    part(identity.chartId),
    part(identity.symbol),
    part(identity.timeframe),
    part(identity.datasetId),
    ...alerts.flatMap((alert) => [
      part(alert.alertId),
      part(alert.price),
      part(alert.direction),
    ]),
  ].join('|');
}

/** Preview and apply an exact per-alert clear plan; never sends global clearAlerts. */
export class ClearAlertsUseCase {
  constructor(
    private readonly chart: ChartPort,
    private readonly desiredState: Pick<ChartDesiredStatePort, 'removeAlert'>,
  ) {}

  async preview(): Promise<ClearAlertsPlan> {
    const context = await this.chart.getContext({ includeCandles: false });
    const identity = exactIdentity(context.identity);
    const observed = context.alerts ?? [];
    const missingIds = observed
      .map((alert, index) => alert.id ? -1 : index)
      .filter((index) => index >= 0);
    if (missingIds.length > 0) {
      throw new ApplicationError(
        'CHART_NOT_READY',
        'Chart returned alerts without stable IDs; scoped clear cannot proceed safely.',
        {
          recovery: {
            action: 'retry',
            instruction: 'Refresh chart state or upgrade romaco-charts before clearing alerts.',
          },
          details: { missingAlertIdIndexes: missingIds },
        },
      );
    }

    const alerts = observed.map((alert) => ({
      alertId: alert.id!,
      price: alert.price,
      direction: alert.direction,
    })).sort((left, right) => (
      left.alertId.localeCompare(right.alertId)
      || left.price - right.price
      || left.direction.localeCompare(right.direction)
    ));
    const duplicateIds = alerts
      .filter((alert, index) => index > 0 && alert.alertId === alerts[index - 1].alertId)
      .map((alert) => alert.alertId);
    if (duplicateIds.length > 0) {
      throw new ApplicationError('CHART_NOT_READY', 'Chart returned duplicate alert IDs.', {
        retryable: true,
        recovery: { action: 'retry', instruction: 'Refresh chart state before clearing alerts.' },
        details: { duplicateAlertIds: duplicateIds },
      });
    }

    return {
      identity,
      alerts,
      fingerprint: planFingerprint(identity, alerts),
    };
  }

  async apply(approvedPlan: ClearAlertsPlan): Promise<ClearAlertsResult> {
    const current = await this.preview();
    if (current.fingerprint !== approvedPlan.fingerprint) {
      throw new ApplicationError('CHART_CONTEXT_MISMATCH', 'Approved alert-clear plan is stale.', {
        recovery: {
          action: 'request_approval',
          instruction: 'Preview current alerts and request a new approval token.',
        },
      });
    }

    const removedAlertIds: string[] = [];
    for (const alert of current.alerts) {
      try {
        const result = await this.chart.execute(
          { action: 'removeAlert', alertId: alert.alertId },
          { expectedIdentity: current.identity },
        );
        if (!result.success) throw new Error(result.error ?? 'Chart rejected alert removal.');
        this.desiredState.removeAlert(alert.alertId, alert.price, alert.direction);
        removedAlertIds.push(alert.alertId);
      } catch (cause) {
        if (removedAlertIds.length > 0) {
          throw new ApplicationError('PARTIAL_APPLY', 'Only part of approved alert-clear plan applied.', {
            retryable: true,
            recovery: {
              action: 'retry',
              instruction: 'Request a fresh preview; already removed alerts remain removed.',
            },
            details: {
              appliedAlertIds: removedAlertIds,
              failedAlertId: alert.alertId,
            },
            cause,
          });
        }
        throw new ApplicationError('ACTION_DENIED', 'Chart rejected approved alert removal.', {
          retryable: true,
          recovery: {
            action: 'retry',
            instruction: 'Verify paired chart identity and host policy, then request new approval.',
          },
          details: { failedAlertId: alert.alertId },
          cause,
        });
      }
    }

    return {
      ...current,
      removedAlertIds,
      removedCount: removedAlertIds.length,
    };
  }
}
