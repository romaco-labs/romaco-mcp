import { describe, expect, it } from 'vitest';
import {
  createJsonlTelemetrySink,
  redactToolInput,
  withToolTelemetry,
  type ToolTelemetryEvent,
} from '../../../src/adapters/inbound/mcp/telemetry.js';

describe('MCP tool telemetry', () => {
  it('redacts secrets, user content, and large arrays', () => {
    const redacted = redactToolInput({
      symbol: 'AAPL',
      token: 'super-secret',
      note: 'private trading note',
      rawCandles: [{ close: 1 }, { close: 2 }],
      nested: { authorization: 'Bearer abc' },
    });

    expect(redacted).toEqual({
      symbol: 'AAPL',
      token: '[REDACTED]',
      note: { redacted: true, length: 20 },
      rawCandles: { redacted: true, count: 2 },
      nested: { authorization: '[REDACTED]' },
    });
    expect(JSON.stringify(redacted)).not.toContain('super-secret');
    expect(JSON.stringify(redacted)).not.toContain('private trading note');
  });

  it('writes one JSONL event and preserves downstream summaries', async () => {
    const lines: string[] = [];
    const sink = createJsonlTelemetrySink((line) => lines.push(line));
    let tick = 1_000;

    const result = await withToolTelemetry(
      {
        sink,
        traceId: 'a'.repeat(32),
        operationId: 'op_1',
        requestId: 'req_1',
        tool: 'romaco_test',
        input: { symbol: 'AAPL' },
        now: () => (tick += 5),
        isoNow: () => '2026-08-29T00:00:00.000Z',
        summarize: () => ({ outcome: 'ok', resultBytes: 42 }),
      },
      async (scope) => {
        scope.recordDownstream({
          adapter: 'fixture-market-data',
          operation: 'load',
          durationMs: 2,
          outcome: 'ok',
        });
        return 'done';
      },
    );

    expect(result).toBe('done');
    expect(lines).toHaveLength(1);
    expect(lines[0].endsWith('\n')).toBe(true);
    const event = JSON.parse(lines[0]) as ToolTelemetryEvent;
    expect(event).toMatchObject({
      schemaVersion: 1,
      event: 'mcp.tool',
      tool: 'romaco_test',
      outcome: 'ok',
      resultBytes: 42,
      input: { symbol: 'AAPL' },
    });
    expect(event.downstreamCalls).toEqual([
      expect.objectContaining({ adapter: 'fixture-market-data', operation: 'load', outcome: 'ok' }),
    ]);
  });

  it('does not let telemetry sink failure break tool behavior', async () => {
    const result = await withToolTelemetry(
      {
        sink: { record: () => { throw new Error('sink unavailable'); } },
        traceId: 'b'.repeat(32),
        operationId: 'op_2',
        requestId: 'req_2',
        tool: 'romaco_test',
        input: {},
        summarize: () => ({ outcome: 'ok' }),
      },
      async () => 7,
    );
    expect(result).toBe(7);
  });
});
