import { ApplicationError } from '../errors.js';
import type { ChartPort } from '../ports/chart.js';
import type { PaperPositionIdempotencyPort } from '../ports/paperPositionIdempotency.js';
import {
  assertPaperPositionIntent,
  paperPositionFingerprint,
  type PaperPositionIntent,
  type PaperPositionReceipt,
} from '../../domain/paper/model.js';
import type { ChartIdentity } from '../../domain/chart/model.js';

export interface OpenPaperPositionInput extends PaperPositionIntent {
  idempotencyKey: string;
}

export type OpenPaperPositionPreparation =
  | { kind: 'replay'; receipt: PaperPositionReceipt }
  | {
      kind: 'ready';
      intent: PaperPositionIntent;
      identity: ChartIdentity;
      idempotencyKey: string;
      fingerprint: string;
      approvalResourceId: string;
    };

export interface OpenPaperPositionResult {
  receipt: PaperPositionReceipt;
  replayed: boolean;
}

function readHostPositionId(data: unknown): string | undefined {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return undefined;
  const record = data as Record<string, unknown>;
  const position = record.position;
  const candidates = [
    record.positionId,
    record.id,
    position && typeof position === 'object' && !Array.isArray(position)
      ? (position as Record<string, unknown>).id
      : undefined,
  ];
  return candidates.find((value): value is string => typeof value === 'string' && value.length > 0);
}

export class OpenPaperPositionUseCase {
  constructor(
    private readonly chart: ChartPort,
    private readonly idempotency: PaperPositionIdempotencyPort,
  ) {}

  async prepare(input: OpenPaperPositionInput): Promise<OpenPaperPositionPreparation> {
    const idempotencyKey = input.idempotencyKey.trim();
    if (!idempotencyKey || idempotencyKey.length > 128) {
      throw new ApplicationError('INVALID_ARGUMENT', 'idempotencyKey must contain 1-128 non-whitespace characters.', {
        recovery: { action: 'change_input', instruction: 'Provide a stable idempotencyKey for this user intent.' },
      });
    }
    try {
      assertPaperPositionIntent(input);
    } catch (cause) {
      throw new ApplicationError('INVALID_ARGUMENT', cause instanceof Error ? cause.message : String(cause), {
        recovery: { action: 'change_input', instruction: 'Use finite positive quantity, stopLoss, and takeProfit values.' },
        cause,
      });
    }
    const identity = await this.chart.getIdentity();
    let fingerprint: string;
    try {
      fingerprint = paperPositionFingerprint(identity, input);
    } catch (cause) {
      throw new ApplicationError('CHART_NOT_READY', 'Paper position requires exact chart identity.', {
        retryable: true,
        recovery: {
          action: 'connect_chart',
          instruction: 'Load a symbol and timeframe in the paired chart, then retry.',
        },
        cause,
      });
    }
    const lookup = this.idempotency.lookup(idempotencyKey, fingerprint);
    if (lookup.kind === 'conflict') {
      throw new ApplicationError(
        'IDEMPOTENCY_CONFLICT',
        'idempotencyKey is already bound to a different paper-position payload.',
        {
          recovery: {
            action: 'change_input',
            instruction: 'Reuse this key only for the exact original payload, or provide a new idempotencyKey.',
          },
          details: { idempotencyKey },
        },
      );
    }
    if (lookup.kind === 'pending') {
      throw new ApplicationError('ACTION_DENIED', 'Same paper-position request is already in progress.', {
        retryable: true,
        recovery: { action: 'retry', instruction: 'Retry the exact request after current execution completes.' },
        details: { idempotencyKey },
      });
    }
    if (lookup.kind === 'replay') return { kind: 'replay', receipt: lookup.receipt };

    const intent: PaperPositionIntent = {
      side: input.side,
      quantity: input.quantity,
      ...(input.stopLoss === undefined ? {} : { stopLoss: input.stopLoss }),
      ...(input.takeProfit === undefined ? {} : { takeProfit: input.takeProfit }),
    };
    return {
      kind: 'ready',
      intent,
      identity,
      idempotencyKey,
      fingerprint,
      approvalResourceId: `${idempotencyKey}|${fingerprint}`,
    };
  }

  async execute(preparation: Extract<OpenPaperPositionPreparation, { kind: 'ready' }>): Promise<OpenPaperPositionResult> {
    const lookup = this.idempotency.lookup(preparation.idempotencyKey, preparation.fingerprint);
    if (lookup.kind === 'replay') return { receipt: lookup.receipt, replayed: true };
    if (lookup.kind === 'conflict') {
      throw new ApplicationError('IDEMPOTENCY_CONFLICT', 'idempotencyKey payload changed before execution.', {
        recovery: { action: 'change_input', instruction: 'Use a new idempotencyKey for a changed payload.' },
        details: { idempotencyKey: preparation.idempotencyKey },
      });
    }
    if (lookup.kind === 'pending' || !this.idempotency.reserve(
      preparation.idempotencyKey,
      preparation.fingerprint,
    )) {
      throw new ApplicationError('ACTION_DENIED', 'Same paper-position request is already in progress.', {
        retryable: true,
        recovery: { action: 'retry', instruction: 'Retry the exact request after current execution completes.' },
        details: { idempotencyKey: preparation.idempotencyKey },
      });
    }

    try {
      const command = preparation.intent.side === 'long'
        ? {
            action: 'openPaperLong' as const,
            quantity: preparation.intent.quantity,
            ...(preparation.intent.stopLoss === undefined ? {} : { stopLoss: preparation.intent.stopLoss }),
            ...(preparation.intent.takeProfit === undefined ? {} : { takeProfit: preparation.intent.takeProfit }),
          }
        : {
            action: 'openPaperShort' as const,
            quantity: preparation.intent.quantity,
            ...(preparation.intent.stopLoss === undefined ? {} : { stopLoss: preparation.intent.stopLoss }),
            ...(preparation.intent.takeProfit === undefined ? {} : { takeProfit: preparation.intent.takeProfit }),
          };
      const result = await this.chart.execute(command, {
        expectedIdentity: preparation.identity,
        idempotencyKey: preparation.idempotencyKey,
      });
      if (!result.success) throw new Error(result.error ?? 'Chart rejected paper position.');
      const hostPositionId = readHostPositionId(result.data);
      const receipt: PaperPositionReceipt = {
        mode: 'paper',
        ...preparation.intent,
        chartIdentity: { ...preparation.identity },
        idempotencyKey: preparation.idempotencyKey,
        ...(hostPositionId ? { hostPositionId } : {}),
      };
      this.idempotency.complete(preparation.idempotencyKey, preparation.fingerprint, receipt);
      return { receipt, replayed: false };
    } catch (cause) {
      this.idempotency.release(preparation.idempotencyKey, preparation.fingerprint);
      throw new ApplicationError('ACTION_DENIED', 'Chart rejected approved paper position.', {
        retryable: true,
        recovery: {
          action: 'retry',
          instruction: 'Verify paired chart identity and paper-trading host policy, then request new approval.',
        },
        details: { idempotencyKey: preparation.idempotencyKey },
        cause,
      });
    }
  }
}
