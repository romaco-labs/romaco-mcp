import { describe, expect, it, vi } from 'vitest';
import { AddDrawingUseCase } from '../../src/application/use-cases/addDrawing.js';
import type { ChartPort } from '../../src/application/ports/chart.js';
import { createChartId } from '../../src/domain/chart/model.js';

function chart(): ChartPort {
  return {
    isConnected: () => true,
    getIdentity: vi.fn(async () => ({
      chartId: createChartId('chart_aapl'), symbol: 'AAPL', timeframe: '1d',
    })),
    getContext: vi.fn(),
    execute: vi.fn(async () => ({ success: true, resourceIds: ['drawing_fib_1'] })),
    replaceDrawingGroup: vi.fn(),
    captureSnapshot: vi.fn(),
  };
}

const templates = {
  findByName: (name: string) => name.toLowerCase() === 'fibretracement'
    ? { name: 'fibRetracement', pointCount: 2 }
    : name.toLowerCase() === 'path'
      ? { name: 'path', pointCount: null }
      : undefined,
};

describe('AddDrawingUseCase', () => {
  it('rejects unknown templates before any chart access', async () => {
    const live = chart();
    const useCase = new AddDrawingUseCase(live, templates, { recordDrawing: vi.fn() });

    await expect(useCase.execute({
      drawingType: 'madeUpShape',
      points: [{ timestamp: 1, price: 100 }],
    })).rejects.toMatchObject({ code: 'INVALID_ARGUMENT' });
    expect(live.getIdentity).not.toHaveBeenCalled();
    expect(live.execute).not.toHaveBeenCalled();
  });

  it('rejects wrong anchor count before any chart write', async () => {
    const live = chart();
    const useCase = new AddDrawingUseCase(live, templates, { recordDrawing: vi.fn() });

    await expect(useCase.execute({
      drawingType: 'fibRetracement',
      points: [{ timestamp: 1, price: 100 }],
    })).rejects.toMatchObject({
      code: 'INVALID_ARGUMENT',
      details: { expectedPointCount: 2, actualPointCount: 1 },
    });
    expect(live.getIdentity).not.toHaveBeenCalled();
    expect(live.execute).not.toHaveBeenCalled();
  });

  it.each([
    { points: [{ timestamp: Number.NaN, price: 100 }] },
    { points: [{ timestamp: 1, price: Number.POSITIVE_INFINITY }] },
  ])('rejects non-finite anchors before any chart write', async ({ points }) => {
    const live = chart();
    const useCase = new AddDrawingUseCase(live, templates, { recordDrawing: vi.fn() });

    await expect(useCase.execute({
      drawingType: 'path', points,
    })).rejects.toMatchObject({ code: 'INVALID_ARGUMENT' });
    expect(live.getIdentity).not.toHaveBeenCalled();
    expect(live.execute).not.toHaveBeenCalled();
  });

  it.each(['user/group', 'romaco-mcp/', `romaco-mcp/${'x'.repeat(246)}`])(
    'rejects non-agent group namespace %s before chart access',
    async (groupId) => {
      const live = chart();
      const recordDrawing = vi.fn();
      const useCase = new AddDrawingUseCase(live, templates, { recordDrawing });

      await expect(useCase.execute({
        drawingType: 'path',
        points: [{ timestamp: 1, price: 100 }],
        groupId,
      })).rejects.toMatchObject({ code: 'INVALID_ARGUMENT' });
      expect(live.getIdentity).not.toHaveBeenCalled();
      expect(live.execute).not.toHaveBeenCalled();
      expect(recordDrawing).not.toHaveBeenCalled();
    },
  );

  it('normalizes and accepts a reserved agent group', async () => {
    const live = chart();
    const recordDrawing = vi.fn();
    const useCase = new AddDrawingUseCase(live, templates, { recordDrawing });

    await useCase.execute({
      drawingType: 'path',
      points: [{ timestamp: 1, price: 100 }],
      groupId: '  romaco-mcp/manual  ',
    });

    expect(live.execute).toHaveBeenCalledWith(
      expect.objectContaining({ groupId: 'romaco-mcp/manual' }),
      expect.anything(),
    );
    expect(recordDrawing).toHaveBeenCalledWith(
      expect.objectContaining({ groupId: 'romaco-mcp/manual' }),
      expect.anything(),
      'drawing_fib_1',
    );
  });

  it('assigns omitted group ownership to the stable manual agent group', async () => {
    const live = chart();
    const recordDrawing = vi.fn();
    const useCase = new AddDrawingUseCase(live, templates, { recordDrawing });

    const result = await useCase.execute({
      drawingType: 'path',
      points: [{ timestamp: 1, price: 100 }],
    });

    expect(result.drawing.groupId).toBe('romaco-mcp/manual');
    expect(live.execute).toHaveBeenCalledWith(
      expect.objectContaining({ groupId: 'romaco-mcp/manual' }),
      expect.anything(),
    );
    expect(recordDrawing).toHaveBeenCalledWith(
      expect.objectContaining({ groupId: 'romaco-mcp/manual' }),
      expect.anything(),
      'drawing_fib_1',
    );
  });

  it('writes canonical template once, returns exact host id, and journals success', async () => {
    const live = chart();
    const recordDrawing = vi.fn();
    const useCase = new AddDrawingUseCase(live, templates, { recordDrawing });
    const points = [{ timestamp: 1, price: 100 }, { timestamp: 2, price: 120 }];

    const result = await useCase.execute({
      drawingType: 'FIBRETRACEMENT', points, paneId: 'main',
    });

    expect(result).toMatchObject({
      drawingId: 'drawing_fib_1',
      chartIdentity: { chartId: 'chart_aapl', symbol: 'AAPL', timeframe: '1d' },
      drawing: { drawingType: 'fibRetracement', points, groupId: 'romaco-mcp/manual' },
    });
    expect(live.execute).toHaveBeenCalledOnce();
    expect(live.execute).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'addDrawing', drawingType: 'fibRetracement', points, groupId: 'romaco-mcp/manual',
      }),
      { expectedIdentity: { chartId: 'chart_aapl', symbol: 'AAPL', timeframe: '1d' } },
    );
    expect(recordDrawing).toHaveBeenCalledWith(
      expect.objectContaining({ drawingType: 'fibRetracement' }),
      { chartId: 'chart_aapl', symbol: 'AAPL', timeframe: '1d' },
      'drawing_fib_1',
    );
  });
});
