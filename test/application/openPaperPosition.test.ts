import { describe, expect, it, vi } from 'vitest';
import { OpenPaperPositionUseCase } from '../../src/application/use-cases/openPaperPosition.js';
import { InMemoryPaperPositionIdempotencyStore } from '../../src/adapters/outbound/persistence/InMemoryPaperPositionIdempotencyStore.js';
import type { ChartPort } from '../../src/application/ports/chart.js';
import { createChartId } from '../../src/domain/chart/model.js';

const identity = { chartId: createChartId('primary'), symbol: 'AAPL', timeframe: '1d' as const };

function fixture() {
  const chart: ChartPort = {
    isConnected: () => true,
    getIdentity: vi.fn(async () => identity),
    getContext: vi.fn(),
    execute: vi.fn(async () => ({ success: true, data: { positionId: 'host-paper-1' } })),
    replaceDrawingGroup: vi.fn(),
    captureSnapshot: vi.fn(),
  };
  return {
    chart,
    useCase: new OpenPaperPositionUseCase(chart, new InMemoryPaperPositionIdempotencyStore()),
  };
}

describe('OpenPaperPositionUseCase', () => {
  it('opens only a paper action with exact identity after preparation', async () => {
    const context = fixture();
    const prepared = await context.useCase.prepare({
      side: 'long', quantity: 10, stopLoss: 145, takeProfit: 160, idempotencyKey: 'paper-aapl-1',
    });
    expect(prepared.kind).toBe('ready');
    if (prepared.kind !== 'ready') throw new Error('fixture unexpectedly replayed');

    const result = await context.useCase.execute(prepared);

    expect(context.chart.execute).toHaveBeenCalledWith(
      { action: 'openPaperLong', quantity: 10, stopLoss: 145, takeProfit: 160 },
      { expectedIdentity: identity, idempotencyKey: 'paper-aapl-1' },
    );
    expect(result).toEqual({
      replayed: false,
      receipt: {
        mode: 'paper',
        side: 'long',
        quantity: 10,
        stopLoss: 145,
        takeProfit: 160,
        chartIdentity: identity,
        idempotencyKey: 'paper-aapl-1',
        hostPositionId: 'host-paper-1',
      },
    });
  });

  it('replays same key/payload receipt without another chart write', async () => {
    const context = fixture();
    const input = { side: 'short' as const, quantity: 3, idempotencyKey: 'paper-aapl-replay' };
    const first = await context.useCase.prepare(input);
    if (first.kind !== 'ready') throw new Error('fixture unexpectedly replayed');
    const applied = await context.useCase.execute(first);

    const replay = await context.useCase.prepare(input);
    expect(replay).toEqual({ kind: 'replay', receipt: applied.receipt });
    expect(context.chart.execute).toHaveBeenCalledTimes(1);
  });

  it('denies same key with different payload before chart write', async () => {
    const context = fixture();
    const first = await context.useCase.prepare({
      side: 'long', quantity: 1, idempotencyKey: 'paper-conflict',
    });
    if (first.kind !== 'ready') throw new Error('fixture unexpectedly replayed');
    await context.useCase.execute(first);

    await expect(context.useCase.prepare({
      side: 'long', quantity: 2, idempotencyKey: 'paper-conflict',
    })).rejects.toMatchObject({ code: 'IDEMPOTENCY_CONFLICT' });
    expect(context.chart.execute).toHaveBeenCalledTimes(1);
  });

  it('releases reservation after host rejection so a fresh approval may retry', async () => {
    const context = fixture();
    vi.mocked(context.chart.execute).mockRejectedValueOnce(new Error('denied'));
    const input = { side: 'long' as const, quantity: 1, idempotencyKey: 'paper-retry' };
    const first = await context.useCase.prepare(input);
    if (first.kind !== 'ready') throw new Error('fixture unexpectedly replayed');
    await expect(context.useCase.execute(first)).rejects.toMatchObject({ code: 'ACTION_DENIED' });

    await expect(context.useCase.prepare(input)).resolves.toMatchObject({ kind: 'ready' });
  });
});

