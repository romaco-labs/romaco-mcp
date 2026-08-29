export type PositionSide = 'long' | 'short';

export interface CalculatePositionSizeInput {
  accountSize: number;
  riskPct: number;
  entryPrice: number;
  stopLoss: number;
  targetPrice?: number;
  commissionPerSide?: number;
}

export interface PositionSizeResult {
  side: PositionSide;
  shares: number;
  entryPrice: number;
  stopLoss: number;
  stopDistance: number;
  positionValue: number;
  positionPctOfAccount: number;
  maxDollarRisk: number;
  actualDollarRisk: number;
  riskPctOfAccount: number;
  targetPrice?: number;
  /** Backward-compatible alias for grossRiskRewardRatio. Excludes commissions. */
  riskRewardRatio?: number;
  grossRiskRewardRatio?: number;
  netRiskRewardRatio?: number | null;
  potentialProfit?: number;
  /** Gross breakeven rate. Excludes commissions for backward compatibility. */
  breakevenWinratePct?: number;
  netBreakevenWinratePct?: number | null;
}

export type PositionSizeErrorCode =
  | 'invalid_number'
  | 'invalid_risk_percentage'
  | 'same_entry_and_stop'
  | 'target_wrong_side';

export class PositionSizeError extends Error {
  constructor(
    readonly code: PositionSizeErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'PositionSizeError';
  }
}

function requirePositiveFinite(name: string, value: number): void {
  if (!Number.isFinite(value) || value <= 0) {
    throw new PositionSizeError('invalid_number', `${name} must be a positive finite number.`);
  }
}

function requireFiniteResult(name: string, value: number): void {
  if (!Number.isFinite(value)) {
    throw new PositionSizeError('invalid_number', `${name} exceeds the supported numeric range.`);
  }
}

export function calculatePositionSize(input: CalculatePositionSizeInput): PositionSizeResult {
  const commissionPerSide = input.commissionPerSide ?? 0;

  requirePositiveFinite('accountSize', input.accountSize);
  requirePositiveFinite('entryPrice', input.entryPrice);
  requirePositiveFinite('stopLoss', input.stopLoss);
  if (!Number.isFinite(input.riskPct) || input.riskPct <= 0 || input.riskPct > 10) {
    throw new PositionSizeError(
      'invalid_risk_percentage',
      'riskPct must be greater than 0 and no greater than 10.',
    );
  }
  if (!Number.isFinite(commissionPerSide) || commissionPerSide < 0) {
    throw new PositionSizeError(
      'invalid_number',
      'commissionPerSide must be a non-negative finite number.',
    );
  }
  if (input.targetPrice !== undefined) requirePositiveFinite('targetPrice', input.targetPrice);

  const stopDistance = Math.abs(input.entryPrice - input.stopLoss);
  if (stopDistance === 0) {
    throw new PositionSizeError(
      'same_entry_and_stop',
      'entryPrice and stopLoss cannot be the same.',
    );
  }

  const side: PositionSide = input.entryPrice > input.stopLoss ? 'long' : 'short';
  if (input.targetPrice !== undefined) {
    const targetIsValid = side === 'long'
      ? input.targetPrice > input.entryPrice
      : input.targetPrice < input.entryPrice;
    if (!targetIsValid) {
      throw new PositionSizeError(
        'target_wrong_side',
        `targetPrice must be ${side === 'long' ? 'above' : 'below'} entryPrice for a ${side} position.`,
      );
    }
  }

  const maxDollarRisk = input.accountSize * (input.riskPct / 100);
  const roundTripCommission = commissionPerSide * 2;
  const riskAvailableForPriceMove = Math.max(0, maxDollarRisk - roundTripCommission);
  const shares = Math.floor(riskAvailableForPriceMove / stopDistance);
  if (!Number.isSafeInteger(shares)) {
    throw new PositionSizeError('invalid_number', 'Calculated shares exceed the safe integer range.');
  }
  const chargedCommission = shares > 0 ? roundTripCommission : 0;
  const actualDollarRisk = shares * stopDistance + chargedCommission;
  const positionValue = shares * input.entryPrice;
  requireFiniteResult('maxDollarRisk', maxDollarRisk);
  requireFiniteResult('actualDollarRisk', actualDollarRisk);
  requireFiniteResult('positionValue', positionValue);

  const result: PositionSizeResult = {
    side,
    shares,
    entryPrice: input.entryPrice,
    stopLoss: input.stopLoss,
    stopDistance,
    positionValue,
    positionPctOfAccount: (positionValue / input.accountSize) * 100,
    maxDollarRisk,
    actualDollarRisk,
    riskPctOfAccount: (actualDollarRisk / input.accountSize) * 100,
  };

  if (input.targetPrice !== undefined) {
    const rewardDistance = Math.abs(input.targetPrice - input.entryPrice);
    const grossRiskRewardRatio = rewardDistance / stopDistance;
    const potentialProfit = shares > 0
      ? shares * rewardDistance - roundTripCommission
      : 0;
    const netRiskRewardRatio = shares > 0 && actualDollarRisk > 0
      ? potentialProfit / actualDollarRisk
      : null;
    const netBreakevenDenominator = actualDollarRisk + potentialProfit;
    requireFiniteResult('grossRiskRewardRatio', grossRiskRewardRatio);
    requireFiniteResult('potentialProfit', potentialProfit);
    if (netRiskRewardRatio !== null) requireFiniteResult('netRiskRewardRatio', netRiskRewardRatio);
    requireFiniteResult('netBreakevenDenominator', netBreakevenDenominator);
    result.targetPrice = input.targetPrice;
    result.riskRewardRatio = grossRiskRewardRatio;
    result.grossRiskRewardRatio = grossRiskRewardRatio;
    result.netRiskRewardRatio = netRiskRewardRatio;
    result.potentialProfit = potentialProfit;
    result.breakevenWinratePct = (1 / (1 + grossRiskRewardRatio)) * 100;
    result.netBreakevenWinratePct = shares > 0 && netBreakevenDenominator > 0
      ? (actualDollarRisk / netBreakevenDenominator) * 100
      : null;
  }

  return result;
}
