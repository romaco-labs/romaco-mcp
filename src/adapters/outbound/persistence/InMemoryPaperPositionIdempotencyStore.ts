import type {
  PaperPositionIdempotencyLookup,
  PaperPositionIdempotencyPort,
} from '../../../application/ports/paperPositionIdempotency.js';
import type { PaperPositionReceipt } from '../../../domain/paper/model.js';

type Record =
  | { fingerprint: string; state: 'pending' }
  | { fingerprint: string; state: 'complete'; receipt: PaperPositionReceipt };

/** Process-local paper execution journal. Never routes or persists real orders. */
export class InMemoryPaperPositionIdempotencyStore implements PaperPositionIdempotencyPort {
  private readonly records = new Map<string, Record>();

  lookup(idempotencyKey: string, fingerprint: string): PaperPositionIdempotencyLookup {
    const record = this.records.get(idempotencyKey);
    if (!record) return { kind: 'missing' };
    if (record.fingerprint !== fingerprint) return { kind: 'conflict' };
    if (record.state === 'pending') return { kind: 'pending' };
    return { kind: 'replay', receipt: record.receipt };
  }

  reserve(idempotencyKey: string, fingerprint: string): boolean {
    if (this.records.has(idempotencyKey)) return false;
    this.records.set(idempotencyKey, { fingerprint, state: 'pending' });
    return true;
  }

  complete(idempotencyKey: string, fingerprint: string, receipt: PaperPositionReceipt): void {
    const record = this.records.get(idempotencyKey);
    if (!record || record.state !== 'pending' || record.fingerprint !== fingerprint) {
      throw new Error('Cannot complete unreserved paper-position idempotency key.');
    }
    this.records.set(idempotencyKey, { fingerprint, state: 'complete', receipt });
  }

  release(idempotencyKey: string, fingerprint: string): void {
    const record = this.records.get(idempotencyKey);
    if (record?.state === 'pending' && record.fingerprint === fingerprint) {
      this.records.delete(idempotencyKey);
    }
  }
}

