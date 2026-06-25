import { describe, it, expect, afterEach, beforeEach } from 'vitest';
import { createTestClient } from './_client.js';

type Harness = Awaited<ReturnType<typeof createTestClient>>;

describe('romaco_calculate_position_size — camelCase schema (B2)', () => {
  let h: Harness;

  beforeEach(async () => {
    h = await createTestClient();
  });
  afterEach(async () => {
    await h.close();
  });

  it('schema declares camelCase keys only', async () => {
    const tools = await h.client.listTools();
    const tool = tools.tools.find((t) => t.name === 'romaco_calculate_position_size');
    expect(tool).toBeTruthy();

    const props = (tool!.inputSchema as { properties?: Record<string, unknown> }).properties ?? {};
    expect(props.accountSize).toBeTruthy();
    expect(props.riskPct).toBeTruthy();
    expect(props.entryPrice).toBeTruthy();
    expect(props.stopLoss).toBeTruthy();
    expect(props.targetPrice).toBeTruthy();
    expect(props.commissionPerSide).toBeTruthy();

    expect(props.account_size).toBeUndefined();
    expect(props.risk_pct).toBeUndefined();
    expect(props.entry_price).toBeUndefined();
  });

  it('accepts camelCase inputs and returns camelCase output keys', async () => {
    const res = await h.callTool('romaco_calculate_position_size', {
      accountSize: 10_000,
      riskPct: 1,
      entryPrice: 100,
      stopLoss: 98,
      targetPrice: 106,
      commissionPerSide: 1,
    });

    expect(res.isError).toBe(false);
    const data = JSON.parse(res.text);

    // camelCase output keys present
    expect(data).toMatchObject({
      side: 'long',
      shares: expect.any(Number),
      entryPrice: 100,
      stopLoss: 98,
      stopDistance: 2,
      positionValue: expect.any(Number),
      positionPctOfAccount: expect.any(Number),
      maxDollarRisk: 100,
      actualDollarRisk: expect.any(Number),
      riskPctOfAccount: expect.any(Number),
      targetPrice: 106,
      riskRewardRatio: 3,
      potentialProfit: expect.any(Number),
      breakevenWinratePct: expect.any(Number),
    });

    // snake_case output keys NOT present
    expect(data.account_size).toBeUndefined();
    expect(data.risk_pct).toBeUndefined();
    expect(data.entry_price).toBeUndefined();
    expect(data.stop_loss).toBeUndefined();
    expect(data.stop_distance).toBeUndefined();
    expect(data.risk_reward_ratio).toBeUndefined();
  });

  it('rejects old snake_case inputs', async () => {
    const res = await h.callTool('romaco_calculate_position_size', {
      account_size: 10_000,
      risk_pct: 1,
      entry_price: 100,
      stop_loss: 98,
    });
    expect(res.isError).toBe(true);
    expect(res.text).toMatch(/Input validation error/);
    // Confirm the missing-field complaint names camelCase keys, not snake_case.
    expect(res.text).toMatch(/accountSize/);
    expect(res.text).toMatch(/riskPct/);
  });

  it('returns isError when entryPrice equals stopLoss', async () => {
    const res = await h.callTool('romaco_calculate_position_size', {
      accountSize: 10_000,
      riskPct: 1,
      entryPrice: 100,
      stopLoss: 100,
    });
    expect(res.isError).toBe(true);
    expect(res.text).toMatch(/entryPrice and stopLoss/);
  });
});
