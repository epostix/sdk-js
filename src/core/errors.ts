import type { ResponseMetadata } from './response.ts';

export const EpostixErrorType = {
  InvalidRequest: 'invalid_request',
  ValidationError: 'validation_error',
  UnsupportedMediaType: 'unsupported_media_type',
  PayloadTooLarge: 'payload_too_large',
  MethodNotAllowed: 'method_not_allowed',
  NotFound: 'not_found',
  AuthenticationFailed: 'authentication_failed',
  ApiKeyExpired: 'api_key_expired',
  InsufficientScope: 'insufficient_scope',
  ApiKeyIpRestricted: 'api_key_ip_restricted',
  DomainScopeRestricted: 'domain_scope_restricted',
  WorkspaceSuspended: 'workspace_suspended',
  TestModeRestricted: 'test_mode_restricted',
  DomainNotFound: 'domain_not_found',
  DomainNotVerified: 'domain_not_verified',
  InvalidFromAddress: 'invalid_from_address',
  DuplicateDetected: 'duplicate_detected',
  InvalidSchedule: 'invalid_schedule',
  EmailNotCancellable: 'email_not_cancellable',
  BatchTooLarge: 'batch_too_large',
  TemplateNotFound: 'template_not_found',
  TemplateRenderFailed: 'template_render_failed',
  AttachmentNotFound: 'attachment_not_found',
  AttachmentExpired: 'attachment_expired',
  AttachmentTooLarge: 'attachment_too_large',
  AttachmentFetchFailed: 'attachment_fetch_failed',
  RateLimitExceeded: 'rate_limit_exceeded',
  DailyQuotaExceeded: 'daily_quota_exceeded',
  MonthlyQuotaExceeded: 'monthly_quota_exceeded',
  IdempotencyConflict: 'idempotency_conflict',
  IdempotencyInProgress: 'idempotency_in_progress',
  ApiKeyInUse: 'api_key_in_use',
  WebhookLimitReached: 'webhook_limit_reached',
  WebhookUrlNotAllowed: 'webhook_url_not_allowed',
  InternalError: 'internal_error',
  ServiceUnavailable: 'service_unavailable',
} as const;

export type EpostixErrorTypeValue = (typeof EpostixErrorType)[keyof typeof EpostixErrorType];

export interface FieldError {
  field: string;
  message: string;
  code: string;
}

export class EpostixError extends Error {
  constructor(message: string) {
    super(message);
    this.name = new.target.name;
  }
}

export type TimeoutPhase = 'connect' | 'read' | 'operationDeadline';

export class EpostixTransportError extends EpostixError {
  readonly cause: unknown;
  readonly responseMetadata: ResponseMetadata;

  constructor(message: string, cause: unknown, responseMetadata: ResponseMetadata) {
    super(message);
    this.cause = cause;
    this.responseMetadata = responseMetadata;
  }
}

export class EpostixTimeoutError extends EpostixTransportError {
  readonly phase: TimeoutPhase;

  constructor(phase: TimeoutPhase, cause: unknown, responseMetadata: ResponseMetadata) {
    super(`request timed out during ${phase}`, cause, responseMetadata);
    this.phase = phase;
  }
}

export class EpostixCancelledError extends EpostixError {
  readonly cause: unknown;

  constructor(cause: unknown) {
    super('the operation was cancelled');
    this.cause = cause;
  }
}

export class EpostixConfigurationError extends EpostixError {}

export type PaginationFailureReason =
  | 'MissingCursor'
  | 'RepeatedCursor'
  | 'ContinuationUnsupported'
  | 'PageLimitExceeded';

export class EpostixPaginationError extends EpostixError {
  readonly reason: PaginationFailureReason;
  readonly operation: string;

  constructor(reason: PaginationFailureReason, operation: string, message: string) {
    super(message);
    this.reason = reason;
    this.operation = operation;
  }
}

export type WebhookFailureReason =
  | 'MissingSignatureHeader'
  | 'MissingTimestampHeader'
  | 'MalformedSignatureHeader'
  | 'TimestampOutOfTolerance'
  | 'NoMatchingSignature'
  | 'MalformedPayload';

export class EpostixWebhookVerificationError extends EpostixError {
  readonly reason: WebhookFailureReason;

  constructor(reason: WebhookFailureReason, message: string) {
    super(message);
    this.reason = reason;
  }
}

export class EpostixOutcomeUnknownError extends EpostixError {
  readonly operation: string;
  readonly idempotencyKey: string | null;
  readonly replayableWithKey: boolean;
  readonly responseMetadata: ResponseMetadata;
  readonly cause: unknown;

  constructor(
    operation: string,
    idempotencyKey: string | null,
    replayableWithKey: boolean,
    responseMetadata: ResponseMetadata,
    cause: unknown,
  ) {
    super(
      `the outcome of ${operation} could not be established: the request may or may not have been accepted`,
    );
    this.operation = operation;
    this.idempotencyKey = idempotencyKey;
    this.replayableWithKey = replayableWithKey;
    this.responseMetadata = responseMetadata;
    this.cause = cause;
  }
}

export interface ApiErrorInit {
  status: number;
  type: string;
  isKnownType: boolean;
  apiMessage: string;
  requestId: string;
  docUrl?: string;
  details: FieldError[];
  responseMetadata: ResponseMetadata;
  rawBodySnippet?: string;
  rawBodyTruncated?: boolean;
}

export class EpostixApiError extends EpostixError {
  readonly status: number;
  readonly type: string;
  readonly isKnownType: boolean;
  readonly apiMessage: string;
  readonly requestId: string;
  readonly docUrl?: string;
  readonly details: FieldError[];
  readonly responseMetadata: ResponseMetadata;
  readonly rawBodySnippet?: string;
  readonly rawBodyTruncated: boolean;

  constructor(init: ApiErrorInit) {
    super(
      `${init.type || 'http_' + init.status}: ${init.apiMessage}` +
        ` (status=${init.status}, request_id=${init.requestId})`,
    );
    this.status = init.status;
    this.type = init.type;
    this.isKnownType = init.isKnownType;
    this.apiMessage = init.apiMessage;
    this.requestId = init.requestId;
    this.docUrl = init.docUrl;
    this.details = init.details;
    this.responseMetadata = init.responseMetadata;
    this.rawBodySnippet = init.rawBodySnippet;
    this.rawBodyTruncated = init.rawBodyTruncated ?? false;
  }
}

export class EpostixInvalidRequestError extends EpostixApiError {}

export class EpostixValidationError extends EpostixApiError {
  get fieldErrors(): FieldError[] {
    return this.details;
  }
}

export class EpostixAuthenticationError extends EpostixApiError {}
export class EpostixPermissionError extends EpostixApiError {}
export class EpostixAccountSuspendedError extends EpostixApiError {}
export class EpostixNotFoundError extends EpostixApiError {}
export class EpostixConflictError extends EpostixApiError {}
export class EpostixIdempotencyConflictError extends EpostixApiError {}
export class EpostixContentError extends EpostixApiError {}
export class EpostixServerError extends EpostixApiError {}

export class EpostixIdempotencyInProgressError extends EpostixApiError {
  get retryAfter(): number | null {
    return this.responseMetadata.retryAfter;
  }
}

export class EpostixRateLimitError extends EpostixApiError {
  get retryAfter(): number | null {
    return this.responseMetadata.retryAfter;
  }

  get rateLimit() {
    return this.responseMetadata.rateLimit;
  }
}

export type QuotaPeriod = 'daily' | 'monthly';

export class EpostixQuotaExceededError extends EpostixApiError {
  get quotaPeriod(): QuotaPeriod {
    return this.type === EpostixErrorType.DailyQuotaExceeded ? 'daily' : 'monthly';
  }

  get retryAfter(): number | null {
    return this.quotaPeriod === 'daily' ? this.responseMetadata.retryAfter : null;
  }

  get nextAttemptAt(): Date | null {
    const retryAfter = this.retryAfter;
    if (retryAfter === null) return null;
    return new Date(Date.now() + retryAfter * 1000);
  }
}

type ApiErrorConstructor = new (init: ApiErrorInit) => EpostixApiError;

const BY_TYPE: Record<string, ApiErrorConstructor> = {
  [EpostixErrorType.InvalidRequest]: EpostixInvalidRequestError,
  [EpostixErrorType.UnsupportedMediaType]: EpostixInvalidRequestError,
  [EpostixErrorType.PayloadTooLarge]: EpostixInvalidRequestError,
  [EpostixErrorType.MethodNotAllowed]: EpostixInvalidRequestError,
  [EpostixErrorType.ValidationError]: EpostixValidationError,
  [EpostixErrorType.InvalidFromAddress]: EpostixValidationError,
  [EpostixErrorType.InvalidSchedule]: EpostixValidationError,
  [EpostixErrorType.BatchTooLarge]: EpostixValidationError,
  [EpostixErrorType.AuthenticationFailed]: EpostixAuthenticationError,
  [EpostixErrorType.ApiKeyExpired]: EpostixAuthenticationError,
  [EpostixErrorType.InsufficientScope]: EpostixPermissionError,
  [EpostixErrorType.ApiKeyIpRestricted]: EpostixPermissionError,
  [EpostixErrorType.DomainScopeRestricted]: EpostixPermissionError,
  [EpostixErrorType.TestModeRestricted]: EpostixPermissionError,
  [EpostixErrorType.WorkspaceSuspended]: EpostixAccountSuspendedError,
  [EpostixErrorType.NotFound]: EpostixNotFoundError,
  [EpostixErrorType.DomainNotFound]: EpostixNotFoundError,
  [EpostixErrorType.TemplateNotFound]: EpostixNotFoundError,
  [EpostixErrorType.AttachmentNotFound]: EpostixNotFoundError,
  [EpostixErrorType.DuplicateDetected]: EpostixConflictError,
  [EpostixErrorType.EmailNotCancellable]: EpostixConflictError,
  [EpostixErrorType.DomainNotVerified]: EpostixConflictError,
  [EpostixErrorType.ApiKeyInUse]: EpostixConflictError,
  [EpostixErrorType.WebhookLimitReached]: EpostixConflictError,
  [EpostixErrorType.WebhookUrlNotAllowed]: EpostixConflictError,
  [EpostixErrorType.IdempotencyConflict]: EpostixIdempotencyConflictError,
  [EpostixErrorType.IdempotencyInProgress]: EpostixIdempotencyInProgressError,
  [EpostixErrorType.RateLimitExceeded]: EpostixRateLimitError,
  [EpostixErrorType.DailyQuotaExceeded]: EpostixQuotaExceededError,
  [EpostixErrorType.MonthlyQuotaExceeded]: EpostixQuotaExceededError,
  [EpostixErrorType.TemplateRenderFailed]: EpostixContentError,
  [EpostixErrorType.AttachmentExpired]: EpostixContentError,
  [EpostixErrorType.AttachmentTooLarge]: EpostixContentError,
  [EpostixErrorType.AttachmentFetchFailed]: EpostixContentError,
  [EpostixErrorType.InternalError]: EpostixServerError,
  [EpostixErrorType.ServiceUnavailable]: EpostixServerError,
};

function byStatus(status: number): ApiErrorConstructor {
  if (status === 401) return EpostixAuthenticationError;
  if (status === 403) return EpostixPermissionError;
  if (status === 404) return EpostixNotFoundError;
  if (status === 409) return EpostixConflictError;
  if (status === 429) return EpostixRateLimitError;
  if (status >= 500) return EpostixServerError;
  if (status >= 400) return EpostixInvalidRequestError;
  return EpostixApiError;
}

export function buildApiError(init: Omit<ApiErrorInit, 'isKnownType'>): EpostixApiError {
  const known = Object.prototype.hasOwnProperty.call(BY_TYPE, init.type);
  const Constructor = known ? BY_TYPE[init.type] : byStatus(init.status);

  return new Constructor({ ...init, isKnownType: known });
}
