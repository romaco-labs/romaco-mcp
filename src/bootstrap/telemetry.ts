import { createJsonlTelemetrySink, type ToolTelemetrySink } from '../adapters/inbound/mcp/telemetry.js';

export interface ToolTelemetryEnvironment {
  ROMACO_MCP_TELEMETRY?: string;
}

export interface ToolTelemetryConfiguration {
  env?: ToolTelemetryEnvironment;
  writeLine?: (line: string) => void | Promise<void>;
}

/**
 * Telemetry is off unless ROMACO_MCP_TELEMETRY=jsonl. Enabled output is local
 * stderr JSONL only; this module performs no network or filesystem I/O.
 */
export function createConfiguredToolTelemetrySink(
  configuration: ToolTelemetryConfiguration = {},
): ToolTelemetrySink | undefined {
  const env = configuration.env ?? process.env;
  if (env.ROMACO_MCP_TELEMETRY?.trim().toLowerCase() !== 'jsonl') return undefined;
  const writeLine = configuration.writeLine ?? ((line: string) => {
    process.stderr.write(line);
  });
  return createJsonlTelemetrySink(writeLine);
}
