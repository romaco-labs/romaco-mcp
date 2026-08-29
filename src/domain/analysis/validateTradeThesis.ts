import type { TradeThesis, TradeSetup, ThesisPoint } from '../../compression/thesis.js';

const record = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);

function parsePoint(value: unknown, path: string): ThesisPoint {
  if (!record(value) || typeof value.factor !== 'string' || !finite(value.weight) || typeof value.detail !== 'string') {
    throw new Error(`Invalid gateway thesis ${path}.`);
  }
  return { factor: value.factor, weight: value.weight, detail: value.detail };
}

function parseSetup(value: unknown): TradeSetup | null {
  if (value === null) return null;
  if (
    !record(value)
    || !finite(value.entry)
    || !finite(value.stop)
    || !finite(value.target)
    || !finite(value.rr)
    || value.entry <= 0
    || value.stop <= 0
    || value.target <= 0
    || value.rr <= 0
    || typeof value.basis !== 'string'
  ) {
    throw new Error('Invalid gateway thesis setup.');
  }
  return {
    entry: value.entry,
    stop: value.stop,
    target: value.target,
    rr: value.rr,
    basis: value.basis,
  };
}

export function validateTradeThesis(value: unknown): TradeThesis {
  if (!record(value)) throw new Error('Invalid gateway thesis payload.');
  if (!['bullish', 'bearish', 'neutral'].includes(String(value.bias))) {
    throw new Error('Invalid gateway thesis bias.');
  }
  if (!['long', 'short', 'stand_aside'].includes(String(value.verdict))) {
    throw new Error('Invalid gateway thesis verdict.');
  }
  if (!finite(value.confidence) || value.confidence < 0 || value.confidence > 1) {
    throw new Error('Invalid gateway thesis confidence.');
  }
  if (!Array.isArray(value.bull) || !Array.isArray(value.bear)) {
    throw new Error('Invalid gateway thesis evidence arrays.');
  }
  const setup = parseSetup(value.setup);
  const verdict = value.verdict as TradeThesis['verdict'];
  if (verdict === 'stand_aside' && setup !== null) {
    throw new Error('Invalid gateway thesis: stand_aside cannot include setup.');
  }
  if (verdict !== 'stand_aside' && setup === null) {
    throw new Error(`Invalid gateway thesis: ${verdict} requires setup.`);
  }
  if (setup) {
    const directional = verdict === 'long'
      ? setup.stop < setup.entry && setup.entry < setup.target
      : setup.target < setup.entry && setup.entry < setup.stop;
    if (!directional) throw new Error('Invalid gateway thesis setup direction.');
    const computed = verdict === 'long'
      ? (setup.target - setup.entry) / (setup.entry - setup.stop)
      : (setup.entry - setup.target) / (setup.stop - setup.entry);
    if (Math.abs(computed - setup.rr) > 0.05) {
      throw new Error('Invalid gateway thesis reward/risk ratio.');
    }
  }
  let invalidation: TradeThesis['invalidation'] = null;
  if (value.invalidation !== null) {
    if (!record(value.invalidation) || !finite(value.invalidation.price) || value.invalidation.price <= 0 || typeof value.invalidation.reason !== 'string') {
      throw new Error('Invalid gateway thesis invalidation.');
    }
    invalidation = { price: value.invalidation.price, reason: value.invalidation.reason };
  }
  if (!['intraday', 'swing', 'position'].includes(String(value.horizon))) {
    throw new Error('Invalid gateway thesis horizon.');
  }
  if (!Array.isArray(value.notes) || !value.notes.every((note) => typeof note === 'string')) {
    throw new Error('Invalid gateway thesis notes.');
  }

  return {
    bias: value.bias as TradeThesis['bias'],
    verdict,
    confidence: value.confidence,
    bull: value.bull.map((point, index) => parsePoint(point, `bull[${index}]`)),
    bear: value.bear.map((point, index) => parsePoint(point, `bear[${index}]`)),
    setup,
    invalidation,
    horizon: value.horizon as TradeThesis['horizon'],
    notes: [...value.notes] as string[],
  };
}
