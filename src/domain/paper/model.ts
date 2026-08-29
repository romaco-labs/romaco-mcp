import type { ChartIdentity } from '../chart/model.js';

export type PaperPositionSide = 'long' | 'short';

export interface PaperPositionIntent {
  side: PaperPositionSide;
  quantity: number;
  stopLoss?: number;
  takeProfit?: number;
}

export interface PaperPositionReceipt extends PaperPositionIntent {
  mode: 'paper';
  chartIdentity: ChartIdentity;
  idempotencyKey: string;
  hostPositionId?: string;
}

export function assertPaperPositionIntent(intent: PaperPositionIntent): void {
  if (!Number.isFinite(intent.quantity) || intent.quantity <= 0) {
    throw new Error('Paper position quantity must be finite and greater than zero.');
  }
  for (const [name, value] of [['stopLoss', intent.stopLoss], ['takeProfit', intent.takeProfit]] as const) {
    if (value !== undefined && (!Number.isFinite(value) || value <= 0)) {
      throw new Error(`Paper position ${name} must be finite and greater than zero.`);
    }
  }
}

function exactIdentity(identity: ChartIdentity): asserts identity is ChartIdentity & {
  symbol: string;
  timeframe: NonNullable<ChartIdentity['timeframe']>;
} {
  if (!identity.symbol || !identity.timeframe) {
    throw new Error('Paper position requires exact chartId, symbol, and timeframe identity.');
  }
}

function part(value: string | number | undefined): string {
  const text = value === undefined ? '' : String(value);
  return `${text.length}:${text}`;
}

/** Collision-resistant canonical identity without runtime or crypto dependencies. */
export function paperPositionFingerprint(
  identity: ChartIdentity,
  intent: PaperPositionIntent,
): string {
  exactIdentity(identity);
  assertPaperPositionIntent(intent);
  return [
    'paper-position-v1',
    part(identity.chartId),
    part(identity.symbol),
    part(identity.timeframe),
    part(identity.datasetId),
    part(intent.side),
    part(intent.quantity),
    part(intent.stopLoss),
    part(intent.takeProfit),
  ].join('|');
}
