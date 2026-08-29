import { describe, expect, it, vi } from 'vitest';
import { ChartReadyReconciliationAdapter } from '../../src/bootstrap/ChartReadyReconciliationAdapter.js';

describe('ChartReadyReconciliationAdapter', () => {
  it('invokes injected application use case from transport ready callback', async () => {
    let ready: (() => void) | undefined;
    const source = { setOnReady: vi.fn((callback: () => void) => { ready = callback; }) };
    const reconcile = {
      execute: vi.fn(async () => ({
        status: 'reconciled' as const,
        applied: 1,
        skippedIdentity: 0,
        failures: [],
      })),
    };
    const adapter = new ChartReadyReconciliationAdapter(reconcile);

    adapter.attach(source);
    ready?.();

    await vi.waitFor(() => expect(reconcile.execute).toHaveBeenCalledOnce());
  });

  it('logs failures without throwing into transport callback', async () => {
    const log = vi.fn();
    const adapter = new ChartReadyReconciliationAdapter({
      execute: vi.fn(async () => ({
        status: 'reconciled' as const,
        applied: 0,
        skippedIdentity: 0,
        failures: [{ action: 'addAlert' as const, message: 'host denied' }],
      })),
    }, log);

    await expect(adapter.handleReady()).resolves.toMatchObject({ status: 'reconciled' });
    expect(log).toHaveBeenCalledWith(expect.stringMatching(/addAlert.*host denied/));
  });
});
