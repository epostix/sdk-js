export interface RateLimitSnapshot {
  limit: number | null;
  remaining: number | null;
  resetAfter: number | null;
  policyBurst: number | null;
  policyWindow: number | null;
  scope: string | null;
  rawPolicy: string | null;
}

export interface AttemptRecord {
  attemptNumber: number;
  startedAt: number;
  elapsed: number;
  statusCode: number | null;
  errorType: string | null;
  retryAfter: number | null;
  sleptBefore: number;
}

export type RetriesExhaustedReason =
  | 'AttemptBudgetExhausted'
  | 'DeadlineExhausted'
  | 'RetryAfterExceedsDeadline'
  | 'NotRetryable'
  | 'OperationExcluded'
  | 'BodyNotReplayable'
  | 'Cancelled';

export interface ResponseMetadata {
  statusCode: number;
  requestId: string;
  rateLimit: RateLimitSnapshot | null;
  retryAfter: number | null;
  idempotentReplayed: boolean;
  idempotencyKey: string | null;
  attempts: number;
  elapsed: number;
  attemptRecords: AttemptRecord[];
  retriesExhaustedReason: RetriesExhaustedReason | null;
  transportMayHaveRetried: boolean | null;
}

export const RESPONSE_METADATA = Symbol.for('epostix.responseMetadata');

function intOf(headers: Headers, name: string): number | null {
  const raw = headers.get(name);
  if (raw === null) return null;
  const value = Number.parseInt(raw, 10);
  return Number.isFinite(value) ? value : null;
}

export function rateLimitFrom(headers: Headers): RateLimitSnapshot | null {
  const rawPolicy = headers.get('RateLimit-Policy');
  const limit = intOf(headers, 'RateLimit-Limit');
  const remaining = intOf(headers, 'RateLimit-Remaining');
  const resetAfter = intOf(headers, 'RateLimit-Reset');
  const scope = headers.get('RateLimit-Scope');

  if (limit === null && remaining === null && resetAfter === null && rawPolicy === null && scope === null) {
    return null;
  }

  let policyBurst: number | null = null;
  let policyWindow: number | null = null;

  if (rawPolicy) {
    const match = /^\s*(\d+)\s*;\s*w\s*=\s*(\d+)\s*$/.exec(rawPolicy);
    if (match) {
      policyBurst = Number.parseInt(match[1], 10);
      policyWindow = Number.parseInt(match[2], 10);
    }
  }

  return { limit, remaining, resetAfter, policyBurst, policyWindow, scope, rawPolicy };
}

export function retryAfterFrom(headers: Headers): number | null {
  return intOf(headers, 'Retry-After');
}

export function attachMetadata<T>(value: T, metadata: ResponseMetadata): T {
  if (value === null || typeof value !== 'object') return value;

  Object.defineProperty(value, RESPONSE_METADATA, {
    value: metadata,
    enumerable: false,
    writable: false,
    configurable: true,
  });

  return value;
}

export function epostixResponseOf(value: object): ResponseMetadata | undefined {
  return (value as Record<symbol, unknown>)[RESPONSE_METADATA] as ResponseMetadata | undefined;
}
