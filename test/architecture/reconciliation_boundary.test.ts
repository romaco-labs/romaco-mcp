import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const SRC = path.resolve('src');

describe('reconnect reconciliation architecture boundary', () => {
  it('has no root global reconciliation module', () => {
    expect(existsSync(path.join(SRC, 'reconcile.ts'))).toBe(false);
  });

  it('keeps application reconciliation free of bridge, session, and adapter imports', () => {
    const source = readFileSync(
      path.join(SRC, 'application/use-cases/reconcileChartState.ts'),
      'utf8',
    );

    expect(source).not.toMatch(/from ['"].*(?:bridge|session|chartState|adapters)\b/);
    expect(source).not.toMatch(/\b(?:WebSocket|McpServer|process\.)/);
  });

  it('injects alert and indicator removal instead of importing process globals', () => {
    for (const relative of [
      'tools/add_alert.ts',
      'tools/remove_alert.ts',
      'tools/remove_indicator.ts',
    ]) {
      const source = readFileSync(path.join(SRC, relative), 'utf8');
      expect(source, relative).not.toMatch(/from ['"]\.\.\/(?:bridge|chartState)\.js['"]/);
    }
  });
});
