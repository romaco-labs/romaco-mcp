import type { ApplicationErrorCode } from '../../../application/errors.js';

export type ToolTelemetryOutcome = 'ok' | 'noop' | 'partial' | 'error' | 'exception';

export interface DownstreamCallTelemetry {
  adapter: string;
  operation: string;
  durationMs: number;
  outcome: 'ok' | 'error';
  errorCode?: string;
}

export interface ToolTelemetryEvent {
  schemaVersion: 1;
  event: 'mcp.tool';
  traceId: string;
  operationId: string;
  requestId: string;
  tool: string;
  startedAt: string;
  durationMs: number;
  outcome: ToolTelemetryOutcome;
  errorCode?: ApplicationErrorCode | string;
  input: Record<string, unknown>;
  resultBytes?: number;
  downstreamCalls: DownstreamCallTelemetry[];
}

export interface ToolTelemetrySink {
  record(event: ToolTelemetryEvent): void | Promise<void>;
}

export interface ToolTelemetryScope {
  recordDownstream(call: DownstreamCallTelemetry): void;
}

export interface ToolTelemetrySummary {
  outcome: ToolTelemetryOutcome;
  errorCode?: ApplicationErrorCode | string;
  resultBytes?: number;
}

export interface ToolTelemetryOptions<T> {
  sink?: ToolTelemetrySink;
  traceId: string;
  operationId: string;
  requestId: string;
  tool: string;
  input: unknown;
  summarize(result: T): ToolTelemetrySummary;
  now?: () => number;
  isoNow?: () => string;
}

const SECRET_KEY = /(authorization|cookie|credential|password|secret|token|api[-_]?key)/i;
const CONTENT_KEY = /(rawcandles|candles|points|note|label|text|prompt|query)/i;
const MAX_DEPTH = 4;

function redactValue(value: unknown, key: string, depth: number): unknown {
  if (SECRET_KEY.test(key)) return '[REDACTED]';
  if (value == null || typeof value === 'number' || typeof value === 'boolean') return value;
  if (typeof value === 'string') {
    if (CONTENT_KEY.test(key)) return { redacted: true, length: value.length };
    return value.length <= 160 ? value : { redacted: true, length: value.length };
  }
  if (Array.isArray(value)) return { redacted: true, count: value.length };
  if (typeof value !== 'object') return String(value);
  if (depth >= MAX_DEPTH) return '[MAX_DEPTH]';

  const output: Record<string, unknown> = {};
  for (const [childKey, childValue] of Object.entries(value as Record<string, unknown>)) {
    output[childKey] = redactValue(childValue, childKey, depth + 1);
  }
  return output;
}

/** Produce bounded, secret-free telemetry input. Arrays become counts, never payloads. */
export function redactToolInput(input: unknown): Record<string, unknown> {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return { value: redactValue(input, 'value', 0) };
  }
  return redactValue(input, 'input', 0) as Record<string, unknown>;
}

export function createJsonlTelemetrySink(
  writeLine: (line: string) => void | Promise<void>,
): ToolTelemetrySink {
  return {
    async record(event) {
      await writeLine(`${JSON.stringify(event)}\n`);
    },
  };
}

/** Decorate one tool call. Telemetry failure never changes tool behavior. */
export async function withToolTelemetry<T>(
  options: ToolTelemetryOptions<T>,
  execute: (scope: ToolTelemetryScope) => Promise<T>,
): Promise<T> {
  const now = options.now ?? Date.now;
  const isoNow = options.isoNow ?? (() => new Date().toISOString());
  const startedAt = isoNow();
  const startedMs = now();
  const downstreamCalls: DownstreamCallTelemetry[] = [];
  const scope: ToolTelemetryScope = {
    recordDownstream(call) {
      downstreamCalls.push({ ...call });
    },
  };

  try {
    const result = await execute(scope);
    const summary = options.summarize(result);
    const event: ToolTelemetryEvent = {
      schemaVersion: 1,
      event: 'mcp.tool',
      traceId: options.traceId,
      operationId: options.operationId,
      requestId: options.requestId,
      tool: options.tool,
      startedAt,
      durationMs: Math.max(0, now() - startedMs),
      outcome: summary.outcome,
      ...(summary.errorCode ? { errorCode: summary.errorCode } : {}),
      input: redactToolInput(options.input),
      ...(summary.resultBytes === undefined ? {} : { resultBytes: summary.resultBytes }),
      downstreamCalls,
    };
    try {
      await options.sink?.record(event);
    } catch {
      // Observability is best-effort. Tool behavior must not depend on log delivery.
    }
    return result;
  } catch (error) {
    const event: ToolTelemetryEvent = {
      schemaVersion: 1,
      event: 'mcp.tool',
      traceId: options.traceId,
      operationId: options.operationId,
      requestId: options.requestId,
      tool: options.tool,
      startedAt,
      durationMs: Math.max(0, now() - startedMs),
      outcome: 'exception',
      errorCode: 'INTERNAL',
      input: redactToolInput(options.input),
      downstreamCalls,
    };
    try {
      await options.sink?.record(event);
    } catch {
      // Preserve original exception.
    }
    throw error;
  }
}
