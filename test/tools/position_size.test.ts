import { describe, expect, it } from 'vitest';
import {
  calculatePositionSize,
  PositionSizeError,
} from '../../src/domain/risk/calculatePositionSize.js';
import { CalculatePositionSizeUseCase } from '../../src/application/use-cases/calculatePositionSize.js';

describe('position size calculation', () => {
  it('sizes a basic long position', () => {
    const result = calculatePositionSize({
      accountSize: 10_000,
      riskPct: 1,
      entryPrice: 150,
      stopLoss: 147,
    });

    expect(result).toMatchObject({
      side: 'long',
      maxDollarRisk: 100,
      stopDistance: 3,
      shares: 33,
      positionValue: 4_950,
      actualDollarRisk: 99,
    });
  });

  it('infers short side when stop is above entry', () => {
    const result = calculatePositionSize({
      accountSize: 10_000,
      riskPct: 1,
      entryPrice: 100,
      stopLoss: 103,
    });
    expect(result.side).toBe('short');
  });

  it('reserves round-trip commission before calculating shares', () => {
    const result = calculatePositionSize({
      accountSize: 10_000,
      riskPct: 1,
      entryPrice: 100,
      stopLoss: 97,
      targetPrice: 109,
      commissionPerSide: 5,
    });

    expect(result.shares).toBe(30); // floor(($100 - $10 commission) / $3)
    expect(result.actualDollarRisk).toBe(100);
    expect(result.actualDollarRisk).toBeLessThanOrEqual(result.maxDollarRisk);
    expect(result.potentialProfit).toBe(260);
    expect(result.riskRewardRatio).toBe(3);
    expect(result.grossRiskRewardRatio).toBe(3);
    expect(result.netRiskRewardRatio).toBeCloseTo(2.6);
    expect(result.breakevenWinratePct).toBeCloseTo(25);
    expect(result.netBreakevenWinratePct).toBeCloseTo(27.78, 1);
  });

  it('returns zero units without phantom commission when commission consumes risk budget', () => {
    const result = calculatePositionSize({
      accountSize: 1_000,
      riskPct: 1,
      entryPrice: 100,
      stopLoss: 99,
      targetPrice: 102,
      commissionPerSide: 5,
    });

    expect(result.shares).toBe(0);
    expect(result.actualDollarRisk).toBe(0);
    expect(result.potentialProfit).toBe(0);
    expect(result.netRiskRewardRatio).toBeNull();
    expect(result.netBreakevenWinratePct).toBeNull();
  });

  it('rejects a long target on or below entry', () => {
    const calculate = () => calculatePositionSize({
      accountSize: 10_000,
      riskPct: 1,
      entryPrice: 100,
      stopLoss: 97,
      targetPrice: 95,
    });
    expect(calculate).toThrowError(PositionSizeError);
    expect(calculate).toThrow(/above entryPrice/);
  });

  it('rejects a short target on or above entry', () => {
    expect(() => calculatePositionSize({
      accountSize: 10_000,
      riskPct: 1,
      entryPrice: 100,
      stopLoss: 103,
      targetPrice: 105,
    })).toThrow(/below entryPrice/);
  });

  it('calculates gross reward/risk and breakeven rate', () => {
    const result = calculatePositionSize({
      accountSize: 10_000,
      riskPct: 1,
      entryPrice: 100,
      stopLoss: 97,
      targetPrice: 106,
    });
    expect(result.riskRewardRatio).toBeCloseTo(2);
    expect(result.grossRiskRewardRatio).toBeCloseTo(2);
    expect(result.netRiskRewardRatio).toBeCloseTo(2);
    expect(result.breakevenWinratePct).toBeCloseTo(33.33, 1);
    expect(result.netBreakevenWinratePct).toBeCloseTo(33.33, 1);
  });

  it('returns zero shares when risk is smaller than stop distance', () => {
    const result = calculatePositionSize({
      accountSize: 1_000,
      riskPct: 0.1,
      entryPrice: 101,
      stopLoss: 1,
    });
    expect(result.shares).toBe(0);
    expect(result.actualDollarRisk).toBe(0);
  });

  it('rejects equal entry and stop', () => {
    expect(() => calculatePositionSize({
      accountSize: 10_000,
      riskPct: 1,
      entryPrice: 100,
      stopLoss: 100,
    })).toThrow(/cannot be the same/);
  });

  it('aligns direct domain risk limits with the MCP maximum', () => {
    expect(() => calculatePositionSize({
      accountSize: 10_000,
      riskPct: 10.1,
      entryPrice: 100,
      stopLoss: 99,
    })).toThrow(/no greater than 10/);
  });

  it('is exposed through a transport-neutral application use case', () => {
    const useCase = new CalculatePositionSizeUseCase();
    const result = useCase.execute({
      accountSize: 10_000,
      riskPct: 1,
      entryPrice: 100,
      stopLoss: 98,
    });
    expect(result.shares).toBe(50);
  });
});
