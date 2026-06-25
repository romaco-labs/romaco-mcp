import { describe, expect, it } from 'vitest';
import { enrichBridgeResult } from '../../src/tools/_guards.js';

describe('enrichBridgeResult', () => {
  it('returns success.data as JSON text and isError=false', () => {
    const out = enrichBridgeResult('tool_x', {
      success: true,
      data: { ok: 1, items: ['a', 'b'] },
    });
    expect(out.isError).toBe(false);
    expect(out.text).toContain('"ok"');
    expect(out.text).toContain('"items"');
  });

  it('passes through string data verbatim', () => {
    const out = enrichBridgeResult('tool_x', { success: true, data: 'hello' });
    expect(out.text).toBe('hello');
    expect(out.isError).toBe(false);
  });

  it('null success data → empty text', () => {
    const out = enrichBridgeResult('tool_x', { success: true });
    expect(out.text).toBe('');
    expect(out.isError).toBe(false);
  });

  it('error matching "Chart not ready" gets setup guidance appended', () => {
    const out = enrichBridgeResult('romaco_add_indicator', {
      success: false,
      error: 'Chart not ready',
    });
    expect(out.isError).toBe(true);
    expect(out.text).toContain('romaco_add_indicator');
    expect(out.text).toContain('Chart not ready');
    expect(out.text).toMatch(/Call romaco_setup_chart/);
    expect(out.text).toMatch(/<McpBridge \/>/);
  });

  it('error matching "no data loaded" gets guidance (case-insensitive)', () => {
    const out = enrichBridgeResult('romaco_add_drawing', {
      success: false,
      error: 'No Data Loaded yet',
    });
    expect(out.isError).toBe(true);
    expect(out.text).toMatch(/Call romaco_setup_chart/);
  });

  it('unrelated error returns "<tool> failed: <error>" without guidance', () => {
    const out = enrichBridgeResult('romaco_set_zoom', {
      success: false,
      error: 'Zoom factor too large',
    });
    expect(out.isError).toBe(true);
    expect(out.text).toBe('romaco_set_zoom failed: Zoom factor too large');
    expect(out.text).not.toMatch(/Call romaco_setup_chart/);
  });

  it('missing error message defaults to "unknown error"', () => {
    const out = enrichBridgeResult('tool_x', { success: false });
    expect(out.isError).toBe(true);
    expect(out.text).toContain('unknown error');
  });
});
