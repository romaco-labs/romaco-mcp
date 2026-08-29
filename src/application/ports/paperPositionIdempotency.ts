import type { PaperPositionReceipt } from '../../domain/paper/model.js';

export type PaperPositionIdempotencyLookup =
  | { kind: 'missing' }
  | { kind: 'conflict' }
  | { kind: 'pending' }
  | { kind: 'replay'; receipt: PaperPositionReceipt };

/** Process-local execution journal. Keys bind permanently to their first payload. */
export interface PaperPositionIdempotencyPort {
  lookup(idempotencyKey: string, fingerprint: string): PaperPositionIdempotencyLookup;
  reserve(idempotencyKey: string, fingerprint: string): boolean;
  complete(idempotencyKey: string, fingerprint: string, receipt: PaperPositionReceipt): void;
  release(idempotencyKey: string, fingerprint: string): void;
}

