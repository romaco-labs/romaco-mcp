import { createHash, randomBytes } from 'node:crypto';
import type {
  ApprovalChallenge,
  ApprovalConsumeResult,
  ApprovalPort,
  ApprovalScope,
} from '../../../application/ports/approval.js';

interface ApprovalRecord {
  scope: string;
  expiresAt: number;
}

export interface InMemoryApprovalStoreOptions {
  now?: () => number;
  createToken?: () => string;
  ttlMs?: number;
  maxEntries?: number;
}

function scopeKey(scope: ApprovalScope): string {
  return `${scope.action}\u0000${scope.resourceId}`;
}

function tokenDigest(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

/** Bounded, process-local, one-time approval store. Raw tokens are never retained. */
export class InMemoryApprovalStore implements ApprovalPort {
  private readonly records = new Map<string, ApprovalRecord>();
  private readonly now: () => number;
  private readonly createToken: () => string;
  private readonly ttlMs: number;
  private readonly maxEntries: number;

  constructor(options: InMemoryApprovalStoreOptions = {}) {
    this.now = options.now ?? Date.now;
    this.createToken = options.createToken ?? (() => randomBytes(32).toString('base64url'));
    this.ttlMs = options.ttlMs ?? 120_000;
    this.maxEntries = options.maxEntries ?? 256;
  }

  issue(scope: ApprovalScope): ApprovalChallenge {
    this.pruneExpired();
    while (this.records.size >= this.maxEntries) {
      const oldest = this.records.keys().next().value as string | undefined;
      if (!oldest) break;
      this.records.delete(oldest);
    }
    const token = this.createToken();
    const expiresAt = this.now() + this.ttlMs;
    this.records.set(tokenDigest(token), { scope: scopeKey(scope), expiresAt });
    return { token, expiresAt };
  }

  consume(scope: ApprovalScope, token: string): ApprovalConsumeResult {
    const digest = tokenDigest(token);
    const record = this.records.get(digest);
    if (!record) return 'invalid';
    this.records.delete(digest);
    if (record.expiresAt <= this.now()) return 'expired';
    return record.scope === scopeKey(scope) ? 'approved' : 'invalid';
  }

  private pruneExpired(): void {
    const now = this.now();
    for (const [digest, record] of this.records) {
      if (record.expiresAt <= now) this.records.delete(digest);
    }
  }
}
