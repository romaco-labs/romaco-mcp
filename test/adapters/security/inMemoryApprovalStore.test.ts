import { describe, expect, it } from 'vitest';
import { InMemoryApprovalStore } from '../../../src/adapters/outbound/security/InMemoryApprovalStore.js';

describe('InMemoryApprovalStore', () => {
  it('binds one token to one action/resource and consumes it once', () => {
    const store = new InMemoryApprovalStore({
      now: () => 1_000,
      createToken: () => 'a'.repeat(43),
    });
    const scope = { action: 'romaco_annotate', resourceId: 'analysis_1' };
    const challenge = store.issue(scope);
    expect(challenge.token).toBe('a'.repeat(43));
    expect(store.consume({ ...scope, resourceId: 'analysis_2' }, challenge.token)).toBe('invalid');
    expect(store.consume(scope, challenge.token)).toBe('invalid');
  });

  it('accepts an exact token once and rejects replay', () => {
    const store = new InMemoryApprovalStore({ createToken: () => 'b'.repeat(43) });
    const scope = { action: 'romaco_annotate', resourceId: 'analysis_1' };
    const { token } = store.issue(scope);
    expect(store.consume(scope, token)).toBe('approved');
    expect(store.consume(scope, token)).toBe('invalid');
  });

  it('rejects expired tokens', () => {
    let now = 1_000;
    const store = new InMemoryApprovalStore({
      now: () => now,
      ttlMs: 10,
      createToken: () => 'c'.repeat(43),
    });
    const scope = { action: 'romaco_annotate', resourceId: 'analysis_1' };
    const { token } = store.issue(scope);
    now = 1_010;
    expect(store.consume(scope, token)).toBe('expired');
  });
});
