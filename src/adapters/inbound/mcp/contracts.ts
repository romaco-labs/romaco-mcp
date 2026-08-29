import { randomBytes, randomUUID } from 'node:crypto';
import type { CallToolResult, ToolAnnotations } from '@modelcontextprotocol/sdk/types.js';
import type { McpServer, RegisteredTool } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import {
  APPLICATION_ERROR_CODES,
  RECOVERY_ACTIONS,
  ApplicationError,
  toApplicationError,
  type ApplicationErrorDTO,
} from '../../../application/errors.js';
import {
  withToolTelemetry,
  type DownstreamCallTelemetry,
  type ToolTelemetrySink,
  type ToolTelemetrySummary,
} from './telemetry.js';

export const TOOL_RESULT_STATUSES = ['ok', 'noop', 'partial', 'error'] as const;
export type ToolResultStatus = (typeof TOOL_RESULT_STATUSES)[number];

export const TOOL_RISK_LEVELS = ['low', 'medium', 'high'] as const;
export type ToolRiskLevel = (typeof TOOL_RISK_LEVELS)[number];

export const TOOL_APPROVAL_POLICIES = [
  'none',
  'explicit-user-intent',
  'confirmation-token',
] as const;
export type ToolApprovalPolicy = (typeof TOOL_APPROVAL_POLICIES)[number];

export interface ToolRiskMetadata {
  level: ToolRiskLevel;
  financial: boolean;
  approval: ToolApprovalPolicy;
}

export interface ToolContextRefs {
  chartId?: string;
  symbol?: string;
  timeframe?: string;
  datasetId?: string;
  analysisId?: string;
}

export interface ToolWarning {
  code: string;
  message: string;
}

export interface ToolTraceIdentifiers {
  traceId: string;
  operationId: string;
  requestId: string;
}

export interface ContractToolExecutionContext extends ToolTraceIdentifiers {
  signal: AbortSignal;
  sessionId?: string;
  recordDownstream(call: DownstreamCallTelemetry): void;
}

export interface ContractToolOutcome<Data extends Record<string, unknown>> {
  status?: Exclude<ToolResultStatus, 'error'>;
  data: Data;
  summary: string;
  context?: ToolContextRefs;
  warnings?: ToolWarning[];
  content?: CallToolResult['content'];
}

export interface ContractToolSpec<
  InputSchema extends z.AnyZodObject,
  DataSchema extends z.AnyZodObject,
> {
  name: string;
  title: string;
  description: string;
  inputSchema: InputSchema;
  dataSchema: DataSchema;
  annotations: ToolAnnotations;
  risk: ToolRiskMetadata;
  contractVersion?: string;
}

export interface RegisterContractToolOptions {
  telemetry?: ToolTelemetrySink;
}

export const recoverySchema = z.object({
  action: z.enum(RECOVERY_ACTIONS),
  instruction: z.string().min(1),
  parameters: z.record(z.unknown()).optional(),
}).strict();

export const toolErrorSchema = z.object({
  code: z.enum(APPLICATION_ERROR_CODES),
  message: z.string().min(1),
  retryable: z.boolean(),
  recovery: recoverySchema.optional(),
  details: z.record(z.unknown()).optional(),
}).strict();

export const toolWarningSchema = z.object({
  code: z.string().min(1),
  message: z.string().min(1),
}).strict();

export const toolContextRefsSchema = z.object({
  chartId: z.string().min(1).optional(),
  symbol: z.string().min(1).optional(),
  timeframe: z.string().min(1).optional(),
  datasetId: z.string().min(1).optional(),
  analysisId: z.string().min(1).optional(),
}).strict();

export function createToolOutputSchema<DataSchema extends z.AnyZodObject>(dataSchema: DataSchema) {
  return z.object({
    status: z.enum(TOOL_RESULT_STATUSES),
    data: dataSchema.strict().nullable(),
    error: toolErrorSchema.nullable(),
    context: toolContextRefsSchema,
    warnings: z.array(toolWarningSchema),
  }).strict();
}

const TRACEPARENT_RE = /^00-([0-9a-f]{32})-([0-9a-f]{16})-([0-9a-f]{2})$/i;

function nonZeroHex(value: string): boolean {
  return /[1-9a-f]/i.test(value);
}

export function createTraceIdentifiers(
  requestId: string | number,
  requestMeta?: Record<string, unknown>,
): ToolTraceIdentifiers {
  const traceparent = typeof requestMeta?.traceparent === 'string' ? requestMeta.traceparent : '';
  const match = TRACEPARENT_RE.exec(traceparent);
  const propagated = match?.[1];
  const traceId = propagated && nonZeroHex(propagated)
    ? propagated.toLowerCase()
    : randomBytes(16).toString('hex');
  return {
    traceId,
    operationId: randomUUID(),
    requestId: String(requestId),
  };
}

function ensureTextContent(summary: string, content?: CallToolResult['content']): CallToolResult['content'] {
  const blocks = content ? [...content] : [];
  if (!blocks.some((block) => block.type === 'text')) {
    blocks.unshift({ type: 'text', text: summary });
  }
  return blocks;
}

function errorSummary(error: ApplicationErrorDTO): string {
  const recovery = error.recovery ? ` Recovery: ${error.recovery.instruction}` : '';
  return `${error.code}: ${error.message}${recovery}`;
}

function byteLength(value: unknown): number {
  return Buffer.byteLength(JSON.stringify(value), 'utf8');
}

function telemetrySummary(result: CallToolResult): ToolTelemetrySummary {
  const structured = result.structuredContent as {
    status?: ToolResultStatus;
    error?: ApplicationErrorDTO | null;
  } | undefined;
  const status = structured?.status ?? (result.isError ? 'error' : 'ok');
  return {
    outcome: status,
    ...(structured?.error?.code ? { errorCode: structured.error.code } : {}),
    ...(result.structuredContent ? { resultBytes: byteLength(result.structuredContent) } : {}),
  };
}

/**
 * Register one MCP adapter with strict input/output contracts and dual output.
 * Domain/application handlers return data; this adapter owns MCP presentation.
 */
export function registerContractTool<
  InputSchema extends z.AnyZodObject,
  DataSchema extends z.AnyZodObject,
>(
  server: McpServer,
  spec: ContractToolSpec<InputSchema, DataSchema>,
  handler: (
    input: z.output<InputSchema>,
    context: ContractToolExecutionContext,
  ) => Promise<ContractToolOutcome<z.output<DataSchema>>> | ContractToolOutcome<z.output<DataSchema>>,
  options: RegisterContractToolOptions = {},
): RegisteredTool {
  const inputSchema = spec.inputSchema.strict();
  const dataSchema = spec.dataSchema.strict();
  const outputSchema = createToolOutputSchema(dataSchema);

  return server.registerTool(
    spec.name,
    {
      title: spec.title,
      description: spec.description,
      inputSchema,
      outputSchema,
      annotations: spec.annotations,
      _meta: {
        'io.romaco/contract': { version: spec.contractVersion ?? '1' },
        'io.romaco/risk': spec.risk,
      },
    },
    async (input, extra): Promise<CallToolResult> => {
      const meta = extra._meta as Record<string, unknown> | undefined;
      const trace = createTraceIdentifiers(extra.requestId, meta);

      return withToolTelemetry(
        {
          sink: options.telemetry,
          ...trace,
          tool: spec.name,
          input,
          summarize: telemetrySummary,
        },
        async (telemetryScope) => {
          try {
            if (extra.signal.aborted) {
              throw new ApplicationError('CANCELLED', 'Tool call was cancelled.', {
                retryable: true,
                recovery: { action: 'retry', instruction: 'Retry when the client is ready.' },
              });
            }

            const outcome = await handler(input, {
              ...trace,
              signal: extra.signal,
              ...(extra.sessionId ? { sessionId: extra.sessionId } : {}),
              recordDownstream: telemetryScope.recordDownstream,
            });
            const parsedData = dataSchema.safeParse(outcome.data);
            if (!parsedData.success) {
              throw new ApplicationError('INTERNAL', 'Tool produced data outside its output contract.', {
                details: {
                  issuePaths: parsedData.error.issues.map((issue) => issue.path.join('.')),
                },
              });
            }

            const structuredContent = {
              status: outcome.status ?? 'ok',
              data: parsedData.data,
              error: null,
              context: outcome.context ?? {},
              warnings: outcome.warnings ?? [],
            };
            return {
              content: ensureTextContent(outcome.summary, outcome.content),
              structuredContent,
              _meta: { 'io.romaco/trace': trace },
            };
          } catch (error) {
            const applicationError = toApplicationError(error);
            const structuredContent = {
              status: 'error' as const,
              data: null,
              error: applicationError.toDTO(),
              context: {},
              warnings: [],
            };
            // Validate error DTO here because SDK 1.30 intentionally skips output
            // validation for isError results.
            outputSchema.parse(structuredContent);
            return {
              content: [{ type: 'text', text: errorSummary(applicationError.toDTO()) }],
              structuredContent,
              isError: true,
              _meta: { 'io.romaco/trace': trace },
            };
          }
        },
      );
    },
  );
}
