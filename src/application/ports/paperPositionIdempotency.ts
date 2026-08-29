import type { PaperPositionReceipt } from '../../domain/paper/model.js';

export type PaperPositionIdempotencyLookup =
  | { kind: 'missing' }
  | { kind: 'conflict' }
  | { kind: 'pending' }
  | { kind: 'indeterminate' }
  | { kind: 'replay'; receipt: PaperPositionReceipt };

/** Process-local execution journal. Keys bind permanently to their first payload. */
export interface PaperPositionIdempotencyPort {
  lookup(idempotencyKey: string, fingerprint: string): PaperPositionIdempotencyLookup;
  reserve(idempotencyKey: string, fingerprint: string): boolean;
  complete(idempotencyKey: string, fingerprint: string, receipt: PaperPositionReceipt): void;
  markIndeterminate(idempotencyKey: string, fingerprint: string): void;
}
