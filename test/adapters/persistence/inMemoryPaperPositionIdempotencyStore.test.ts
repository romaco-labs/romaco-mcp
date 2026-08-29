import { describe, expect, it } from 'vitest';
import { InMemoryPaperPositionIdempotencyStore } from '../../../src/adapters/outbound/persistence/InMemoryPaperPositionIdempotencyStore.js';
import { createChartId } from '../../../src/domain/chart/model.js';

describe('InMemoryPaperPositionIdempotencyStore', () => {
  it('reserves once, rejects conflicting payload, and replays exact receipt', () => {
    const store = new InMemoryPaperPositionIdempotencyStore();
    expect(store.reserve('key', 'payload-a')).toBe(true);
    expect(store.reserve('key', 'payload-a')).toBe(false);
    expect(store.lookup('key', 'payload-a')).toEqual({ kind: 'pending' });
    expect(store.lookup('key', 'payload-b')).toEqual({ kind: 'conflict' });

    const receipt = {
      mode: 'paper' as const,
      side: 'long' as const,
      quantity: 1,
      chartIdentity: { chartId: createChartId('primary'), symbol: 'AAPL', timeframe: '1d' as const },
      idempotencyKey: 'key',
    };
    store.complete('key', 'payload-a', receipt);
    expect(store.lookup('key', 'payload-a')).toEqual({ kind: 'replay', receipt });
  });

  it('retains terminal indeterminate binding after ambiguous execution', () => {
    const store = new InMemoryPaperPositionIdempotencyStore();
    expect(store.reserve('key', 'payload-a')).toBe(true);
    store.markIndeterminate('key', 'payload-a');
    expect(store.lookup('key', 'payload-a')).toEqual({ kind: 'indeterminate' });
    expect(store.lookup('key', 'payload-b')).toEqual({ kind: 'conflict' });
    expect(store.reserve('key', 'payload-a')).toBe(false);
  });
});
