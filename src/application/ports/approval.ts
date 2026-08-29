export interface ApprovalScope {
  action: string;
  resourceId: string;
}

export interface ApprovalChallenge {
  token: string;
  expiresAt: number;
}

export type ApprovalConsumeResult = 'approved' | 'invalid' | 'expired';

/** One-time confirmation capability. Implementations must bind tokens to scope. */
export interface ApprovalPort {
  issue(scope: ApprovalScope): ApprovalChallenge;
  consume(scope: ApprovalScope, token: string): ApprovalConsumeResult;
}
