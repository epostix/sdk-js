import {
  EpostixApiError, EpostixErrorType, EpostixIdempotencyInProgressError, EpostixRateLimitError,
} from './errors.ts';
import type { RetriesExhaustedReason } from './response.ts';

export type RetryClass =
  | 'SafeRead'
  | 'NaturallyIdempotent'
  | 'DeduplicatedAdmission'
  | 'ExcludedMutation'
  | 'Streaming';

export type MutationRetryMode = 'Never' | 'OnlyWhenDeduplicated' | 'Always';

export interface RetryPolicy {
  maximumRetries: number;
  operationDeadline: number;
  connectTimeout: number;
  readTimeout: number;
  backoffBase: number;
  backoffMaximum: number;
  backoffMultiplier: number;
  honorRetryAfter: boolean;
  mutationRetry: MutationRetryMode;
}

export const defaultRetryPolicy: RetryPolicy = {
  maximumRetries: 2,
  operationDeadline: 30_000,
  connectTimeout: 5_000,
  readTimeout: 30_000,
  backoffBase: 250,
  backoffMaximum: 2_000,
  backoffMultiplier: 2,
  honorRetryAfter: true,
  mutationRetry: 'OnlyWhenDeduplicated',
};

export const disabledRetryPolicy: RetryPolicy = { ...defaultRetryPolicy, maximumRetries: 0 };

export const uploadRetryPolicy: RetryPolicy = {
  ...defaultRetryPolicy,
  operationDeadline: 180_000,
  connectTimeout: 30_000,
  readTimeout: 180_000,
};

export const batchRetryPolicy: RetryPolicy = {
  ...defaultRetryPolicy,
  operationDeadline: 90_000,
  readTimeout: 90_000,
};

const NEVER_RETRY = new Set<string>([
  EpostixErrorType.AuthenticationFailed,
  EpostixErrorType.ApiKeyExpired,
  EpostixErrorType.InsufficientScope,
  EpostixErrorType.ApiKeyIpRestricted,
  EpostixErrorType.DomainScopeRestricted,
  EpostixErrorType.TestModeRestricted,
  EpostixErrorType.WorkspaceSuspended,
  EpostixErrorType.ValidationError,
  EpostixErrorType.InvalidRequest,
  EpostixErrorType.InvalidFromAddress,
  EpostixErrorType.InvalidSchedule,
  EpostixErrorType.BatchTooLarge,
  EpostixErrorType.PayloadTooLarge,
  EpostixErrorType.UnsupportedMediaType,
  EpostixErrorType.MethodNotAllowed,
  EpostixErrorType.EmailNotCancellable,
  EpostixErrorType.DuplicateDetected,
  EpostixErrorType.DomainNotVerified,
  EpostixErrorType.ApiKeyInUse,
  EpostixErrorType.WebhookLimitReached,
  EpostixErrorType.WebhookUrlNotAllowed,
  EpostixErrorType.NotFound,
  EpostixErrorType.DomainNotFound,
  EpostixErrorType.TemplateNotFound,
  EpostixErrorType.AttachmentNotFound,
  EpostixErrorType.AttachmentExpired,
  EpostixErrorType.AttachmentTooLarge,
  EpostixErrorType.TemplateRenderFailed,
  EpostixErrorType.IdempotencyConflict,
  EpostixErrorType.DailyQuotaExceeded,
  EpostixErrorType.MonthlyQuotaExceeded,
]);

export type RetryDecision =
  | { action: 'stop'; reason: RetriesExhaustedReason }
  | { action: 'retry'; delay: number };

export interface ClassifyContext {
  policy: RetryPolicy;
  retryClass: RetryClass;
  attemptNumber: number;
  remaining: number;
  error: unknown;
  hasIdempotencyKey: boolean;
  bodyIsReplayable: boolean;
  bytesWereWritten: boolean;
  responseStarted: boolean;
  random: () => number;
}

function fullJitter(policy: RetryPolicy, attemptNumber: number, random: () => number): number {
  const ceiling = Math.min(
    policy.backoffMaximum,
    policy.backoffBase * Math.pow(policy.backoffMultiplier, attemptNumber - 1),
  );

  return Math.floor(random() * ceiling);
}

function fitsDeadline(delay: number, ctx: ClassifyContext): boolean {
  return delay + ctx.policy.connectTimeout <= ctx.remaining;
}

function classForTransient(ctx: ClassifyContext): RetryDecision {
  switch (ctx.retryClass) {
    case 'SafeRead':
    case 'NaturallyIdempotent':
      return { action: 'retry', delay: fullJitter(ctx.policy, ctx.attemptNumber, ctx.random) };

    case 'Streaming':
      return ctx.responseStarted
        ? { action: 'stop', reason: 'NotRetryable' }
        : { action: 'retry', delay: fullJitter(ctx.policy, ctx.attemptNumber, ctx.random) };

    case 'ExcludedMutation':
      return ctx.bytesWereWritten
        ? { action: 'stop', reason: 'OperationExcluded' }
        : { action: 'retry', delay: fullJitter(ctx.policy, ctx.attemptNumber, ctx.random) };

    case 'DeduplicatedAdmission': {
      if (ctx.policy.mutationRetry === 'Never') return { action: 'stop', reason: 'OperationExcluded' };
      if (ctx.policy.mutationRetry === 'Always') {
        return { action: 'retry', delay: fullJitter(ctx.policy, ctx.attemptNumber, ctx.random) };
      }
      if (!ctx.hasIdempotencyKey) return { action: 'stop', reason: 'OperationExcluded' };
      if (!ctx.bodyIsReplayable) return { action: 'stop', reason: 'BodyNotReplayable' };
      return { action: 'retry', delay: fullJitter(ctx.policy, ctx.attemptNumber, ctx.random) };
    }
  }
}

export function classifyAttempt(ctx: ClassifyContext): RetryDecision {
  if (ctx.attemptNumber > ctx.policy.maximumRetries) {
    return { action: 'stop', reason: 'AttemptBudgetExhausted' };
  }

  if (ctx.remaining <= ctx.policy.connectTimeout) {
    return { action: 'stop', reason: 'DeadlineExhausted' };
  }

  const error = ctx.error;

  if (error instanceof EpostixApiError) {
    if (NEVER_RETRY.has(error.type)) return { action: 'stop', reason: 'NotRetryable' };

    if (error instanceof EpostixIdempotencyInProgressError || error instanceof EpostixRateLimitError) {
      const retryAfter = error.responseMetadata.retryAfter;
      if (!ctx.policy.honorRetryAfter || retryAfter === null) {
        return classForTransient(ctx);
      }

      const delay = retryAfter * 1000;
      return fitsDeadline(delay, ctx)
        ? { action: 'retry', delay }
        : { action: 'stop', reason: 'RetryAfterExceedsDeadline' };
    }

    const retryableStatus = error.status === 408 || error.status >= 500;
    const retryableType = error.type === EpostixErrorType.AttachmentFetchFailed;

    if (!retryableStatus && !retryableType) return { action: 'stop', reason: 'NotRetryable' };

    const decision = classForTransient(ctx);
    if (decision.action === 'retry' && !fitsDeadline(decision.delay, ctx)) {
      return { action: 'stop', reason: 'DeadlineExhausted' };
    }
    return decision;
  }

  const decision = classForTransient(ctx);
  if (decision.action === 'retry' && !fitsDeadline(decision.delay, ctx)) {
    return { action: 'stop', reason: 'DeadlineExhausted' };
  }
  return decision;
}
