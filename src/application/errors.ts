export const APPLICATION_ERROR_CODES = [
  'INVALID_ARGUMENT',
  'ACK_REQUIRED',
  'APPROVAL_REQUIRED',
  'APPROVAL_INVALID',
  'IDEMPOTENCY_CONFLICT',
  'SESSION_NOT_LOADED',
  'DATASET_NOT_FOUND',
  'ANALYSIS_NOT_FOUND',
  'DATA_SOURCE_UNAVAILABLE',
  'EMPTY_DATASET',
  'CHART_NOT_CONNECTED',
  'CHART_NOT_READY',
  'CHART_CONTEXT_MISMATCH',
  'ACTION_DENIED',
  'NOT_FOUND',
  'BRIDGE_TIMEOUT',
  'BRIDGE_DISCONNECTED',
  'GATEWAY_UNAUTHORIZED',
  'GATEWAY_UNAVAILABLE',
  'PARTIAL_APPLY',
  'CANCELLED',
  'INTERNAL',
] as const;

export type ApplicationErrorCode = (typeof APPLICATION_ERROR_CODES)[number];

export type JsonPrimitive = string | number | boolean | null;
export type JsonValue =
  | JsonPrimitive
  | JsonValue[]
  | { [key: string]: JsonValue };

export const RECOVERY_ACTIONS = [
  'retry',
  'acknowledge_cost',
  'request_approval',
  'load_dataset',
  'select_dataset',
  'select_analysis',
  'connect_chart',
  'match_chart_identity',
  'change_input',
  'contact_support',
] as const;

export type RecoveryAction = (typeof RECOVERY_ACTIONS)[number];

/** Transport-neutral recovery guidance. Inbound adapters choose how to present it. */
export interface RecoveryDTO {
  action: RecoveryAction;
  instruction: string;
  parameters?: Record<string, JsonValue>;
}

/** Safe application error shape. Never place credentials or raw market data in details. */
export interface ApplicationErrorDTO {
  code: ApplicationErrorCode;
  message: string;
  retryable: boolean;
  recovery?: RecoveryDTO;
  details?: Record<string, JsonValue>;
}

export interface ApplicationErrorOptions {
  retryable?: boolean;
  recovery?: RecoveryDTO;
  details?: Record<string, JsonValue>;
  cause?: unknown;
}

export class ApplicationError extends Error {
  readonly code: ApplicationErrorCode;
  readonly retryable: boolean;
  readonly recovery?: RecoveryDTO;
  readonly details?: Record<string, JsonValue>;

  constructor(code: ApplicationErrorCode, message: string, options: ApplicationErrorOptions = {}) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = 'ApplicationError';
    this.code = code;
    this.retryable = options.retryable ?? false;
    this.recovery = options.recovery;
    this.details = options.details;
  }

  toDTO(): ApplicationErrorDTO {
    return {
      code: this.code,
      message: this.message,
      retryable: this.retryable,
      ...(this.recovery ? { recovery: this.recovery } : {}),
      ...(this.details ? { details: this.details } : {}),
    };
  }
}

export function toApplicationError(error: unknown): ApplicationError {
  if (error instanceof ApplicationError) return error;
  return new ApplicationError('INTERNAL', 'Unexpected internal error.', {
    retryable: false,
    cause: error,
  });
}
