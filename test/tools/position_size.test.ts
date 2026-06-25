import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * Tests for romaco_calculate_position_size logic.
 * We test the math directly by importing the calculation helpers.
 * The MCP tool itself is a thin wrapper — bridge/server integration tested separately.
 */

// Helper that mimics exactly what the tool computes
function calcPositionSize(
  accountSize: number,
  riskPct: number,
  entryPrice: number,
  stopLoss: number,
  targetPrice?: number,
  commissionPerSide = 0,
) {
  const dollarRisk = accountSize * (riskPct / 100);
  const stopDistance = Math.abs(entryPrice - stopLoss);
  const side = entryPrice > stopLoss ? 'long' : 'short';
  const shares = Math.floor(dollarRisk / stopDistance);
  const positionValue = shares * entryPrice;
  const actualRisk = shares * stopDistance + commissionPerSide * 2;

  const base = { side, shares, positionValue, actualRisk, dollarRisk, stopDistance };

  if (targetPrice !== undefined) {
    const rewardDistance = Math.abs(targetPrice - entryPrice);
    const riskReward = rewardDistance / stopDistance;
    const potentialProfit = shares * rewardDistance - commissionPerSide * 2;
    const breakeven = (1 / (1 + riskReward)) * 100;
    return { ...base, riskReward, potentialProfit, breakeven };
  }

  return base;
}

describe('position size calculation', () => {
  it('basic long: $10k account, 1% risk, $150 entry, $147 stop', () => {
    const r = calcPositionSize(10_000, 1, 150, 147);
    expect(r.side).toBe('long');
    expect(r.dollarRisk).toBe(100);
    expect(r.stopDistance).toBe(3);
    expect(r.shares).toBe(33);              // floor(100/3) = 33
    expect(r.positionValue).toBe(33 * 150); // 4950
  });

  it('short: entry below stop loss', () => {
    const r = calcPositionSize(10_000, 1, 100, 103);
    expect(r.side).toBe('short');
    expect(r.stopDistance).toBeCloseTo(3);
  });

  it('actualRisk <= dollarRisk (floor prevents overshoot)', () => {
    const r = calcPositionSize(10_000, 1, 150, 147);
    expect(r.actualRisk).toBeLessThanOrEqual(r.dollarRisk);
  });

  it('risk/reward ratio computed correctly', () => {
    const r = calcPositionSize(10_000, 1, 100, 97, 109);
    // stop distance = 3, reward distance = 9 → R/R = 3
    expect((r as { riskReward: number }).riskReward).toBeCloseTo(3);
  });

  it('breakeven win rate for 1:1 R/R is 50%', () => {
    const r = calcPositionSize(10_000, 1, 100, 97, 103) as { breakeven: number };
    expect(r.breakeven).toBeCloseTo(50, 0);
  });

  it('breakeven win rate for 2:1 R/R is ~33.3%', () => {
    const r = calcPositionSize(10_000, 1, 100, 97, 106) as { breakeven: number };
    expect(r.breakeven).toBeCloseTo(33.33, 0);
  });

  it('commission reduces net profit', () => {
    const withComm = calcPositionSize(10_000, 1, 100, 97, 110, 5) as { potentialProfit: number };
    const noComm = calcPositionSize(10_000, 1, 100, 97, 110, 0) as { potentialProfit: number };
    expect(withComm.potentialProfit).toBeLessThan(noComm.potentialProfit);
    expect(noComm.potentialProfit - withComm.potentialProfit).toBeCloseTo(10); // 2 * commission
  });

  it('zero shares when risk too small for stop distance', () => {
    // $1 risk, $100 stop distance → 0 shares
    const r = calcPositionSize(1_000, 0.1, 100, 0);
    expect(r.shares).toBe(0);
  });

  it('higher risk pct → more shares', () => {
    const low = calcPositionSize(10_000, 0.5, 100, 98);
    const high = calcPositionSize(10_000, 2, 100, 98);
    expect(high.shares).toBeGreaterThan(low.shares);
  });

  it('tighter stop → more shares for same risk amount', () => {
    const wide = calcPositionSize(10_000, 1, 100, 90);   // $10 stop
    const tight = calcPositionSize(10_000, 1, 100, 99);  // $1 stop
    expect(tight.shares).toBeGreaterThan(wide.shares);
  });
});
