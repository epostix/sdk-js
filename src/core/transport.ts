import type { Codec } from './codec.ts';
import {
  buildApiError, EpostixApiError, EpostixCancelledError, EpostixConfigurationError,
  EpostixOutcomeUnknownError, EpostixTimeoutError, EpostixTransportError,
} from './errors.ts';
import type { FieldError } from './errors.ts';
import {
  attachMetadata, rateLimitFrom, retryAfterFrom,
} from './response.ts';
import type { AttemptRecord, ResponseMetadata, RetriesExhaustedReason } from './response.ts';
import { classifyAttempt, defaultRetryPolicy } from './retry.ts';
import type { RetryClass, RetryPolicy } from './retry.ts';
import { isPlainObject } from './json.ts';

export const IDEMPOTENCY_KEY_MAXIMUM_LENGTH = 255;
export const IDEMPOTENCY_RETENTION_HOURS = 24;
const RAW_BODY_SNIPPET_LIMIT = 8192;

export interface OperationSpec {
  id: string;
  method: string;
  pathLiterals: readonly string[];
  pathParams: readonly string[];
  successStatus: number;
  empty: boolean;
  binary: boolean;
  idempotent: boolean;
  retryClass: RetryClass;
}

export interface RequestOptions {
  signal?: AbortSignal;
  retryPolicy?: RetryPolicy;
  operationDeadline?: number;
  headers?: Record<string, string>;
  baseUrl?: string;
}

export interface IdempotentRequestOptions extends RequestOptions {
  idempotencyKey?: string;
}

export interface QueryParams {
  [key: string]: unknown;
}

export interface ExecuteInput {
  path?: readonly string[];
  query?: object | undefined;
  body?: unknown;
  encode?: Codec<unknown>;
  decode?: Codec<unknown>;
}

export interface TransportConfig {
  apiKey: string;
  baseUrl: string;
  retryPolicy: RetryPolicy;
  fetch: typeof fetch;
  defaultHeaders: Record<string, string>;
  userAgent: string;
  automaticIdempotencyKeys: boolean;
  randomValues: (size: number) => Uint8Array;
  now: () => number;
  observer?: (record: AttemptRecord & { operation: string }) => void;
  configurationError?: EpostixConfigurationError;
}

function emptyMetadata(): ResponseMetadata {
  return {
    statusCode: 0,
    requestId: '',
    rateLimit: null,
    retryAfter: null,
    idempotentReplayed: false,
    idempotencyKey: null,
    attempts: 0,
    elapsed: 0,
    attemptRecords: [],
    retriesExhaustedReason: null,
    transportMayHaveRetried: null,
  };
}

function buildPath(spec: OperationSpec, values: readonly string[] | undefined): string {
  let out = '';

  for (let i = 0; i < spec.pathLiterals.length; i += 1) {
    out += spec.pathLiterals[i];

    if (i < spec.pathParams.length) {
      const value = values?.[i];
      if (value === undefined || value === null || value === '') {
        throw new EpostixConfigurationError(
          `${spec.id}: path parameter "${spec.pathParams[i]}" is required`,
        );
      }
      out += encodeURIComponent(String(value));
    }
  }

  return out;
}

function buildQuery(query: object | undefined): string {
  if (!query) return '';

  const params = new URLSearchParams();

  for (const [key, value] of Object.entries(query as Record<string, unknown>)) {
    if (value === undefined || value === null) continue;

    const wire = key.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`);

    if (Array.isArray(value)) {
      for (const item of value) params.append(wire, serializeQueryValue(item));
      continue;
    }

    params.append(wire, serializeQueryValue(value));
  }

  const text = params.toString();
  return text.length > 0 ? `?${text}` : '';
}

function serializeQueryValue(value: unknown): string {
  if (value instanceof Date) return value.toISOString();
  return String(value);
}

function detailsOf(body: unknown): FieldError[] {
  if (!isPlainObject(body) || !Array.isArray(body.details)) return [];

  return body.details.flatMap((entry) =>
    isPlainObject(entry)
      ? [{
          field: String(entry.field ?? ''),
          message: String(entry.message ?? ''),
          code: String(entry.code ?? ''),
        }]
      : [],
  );
}

function sleep(ms: number, signal: AbortSignal | undefined): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new EpostixCancelledError(signal.reason));
      return;
    }

    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);

    function onAbort(): void {
      clearTimeout(timer);
      reject(new EpostixCancelledError(signal!.reason));
    }

    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

export class EpostixTransport {
  private readonly config: TransportConfig;

  constructor(config: TransportConfig) {
    this.config = config;
  }

  generateIdempotencyKey(): string {
    const bytes = this.config.randomValues(16);
    let hex = '';
    for (const byte of bytes) hex += byte.toString(16).padStart(2, '0');
    return `epx_auto_${hex}`;
  }

  async executeRaw(
    spec: OperationSpec,
    input: ExecuteInput,
    options?: RequestOptions,
  ): Promise<{ body: ReadableStream<Uint8Array> | null; headers: Headers; responseMetadata: ResponseMetadata }> {
    if (this.config.configurationError) throw this.config.configurationError;

    const policy = options?.retryPolicy ?? this.config.retryPolicy;
    const started = this.config.now();
    const url = (options?.baseUrl ?? this.config.baseUrl) + buildPath(spec, input.path) + buildQuery(input.query);

    const headers: Record<string, string> = {
      accept: '*/*',
      authorization: `Bearer ${this.config.apiKey}`,
      'user-agent': this.config.userAgent,
      ...this.config.defaultHeaders,
      ...options?.headers,
    };

    const attemptSignal = this.attemptSignal(
      options?.signal,
      Math.max(1, Math.floor(Math.min(policy.operationDeadline, policy.readTimeout))),
    );

    const response = await this.config.fetch(url, {
      method: spec.method,
      headers,
      signal: attemptSignal.signal,
    });

    const metadata = this.metadataOf(response, {
      attemptNumber: 1, started, idempotencyKey: null, attemptRecords: [],
    });

    if (response.status < 200 || response.status >= 300) {
      throw await this.errorOf(response, metadata);
    }

    return { body: response.body, headers: response.headers, responseMetadata: metadata };
  }

  async execute<T>(spec: OperationSpec, input: ExecuteInput, options?: RequestOptions): Promise<T> {
    if (this.config.configurationError) throw this.config.configurationError;

    const policy = options?.retryPolicy ?? this.config.retryPolicy;
    const deadline = options?.operationDeadline ?? policy.operationDeadline;
    const started = this.config.now();

    const idempotencyKey = this.resolveIdempotencyKey(spec, options);

    const bodyBytes = this.serializeBody(input);
    const url = (options?.baseUrl ?? this.config.baseUrl) + buildPath(spec, input.path) + buildQuery(input.query);

    const attemptRecords: AttemptRecord[] = [];
    let attemptNumber = 0;
    let sleptBefore = 0;
    let lastError: unknown;
    let bytesWereWritten = false;
    let exhausted: RetriesExhaustedReason | null = null;

    for (;;) {
      attemptNumber += 1;

      if (options?.signal?.aborted) throw new EpostixCancelledError(options.signal.reason);

      const attemptStart = this.config.now();
      const remaining = deadline - (attemptStart - started);

      const headers: Record<string, string> = {
        accept: 'application/json',
        authorization: `Bearer ${this.config.apiKey}`,
        'user-agent': this.config.userAgent,
        ...this.config.defaultHeaders,
        ...options?.headers,
      };

      if (bodyBytes) headers['content-type'] = 'application/json';
      if (idempotencyKey) headers['idempotency-key'] = idempotencyKey;

      const attemptSignal = this.attemptSignal(
        options?.signal,
        Math.max(1, Math.floor(Math.min(remaining, policy.readTimeout))),
      );

      let response: Response | undefined;
      let failure: unknown;

      try {
        response = await this.config.fetch(url, {
          method: spec.method,
          headers,
          body: bodyBytes ? new Uint8Array(bodyBytes) : undefined,
          signal: attemptSignal.signal,
        });
        bytesWereWritten = true;
      } catch (error) {
        failure = error;
        if (bodyBytes) bytesWereWritten = true;
      } finally {
        attemptSignal.dispose();
      }

      const elapsed = this.config.now() - attemptStart;

      if (response) {
        const metadata = this.metadataOf(response, {
          attemptNumber,
          started,
          idempotencyKey,
          attemptRecords,
        });

        if (response.status >= 200 && response.status < 300) {
          attemptRecords.push({
            attemptNumber, startedAt: attemptStart, elapsed,
            statusCode: response.status, errorType: null, retryAfter: null, sleptBefore,
          });
          metadata.attempts = attemptNumber;
          metadata.elapsed = this.config.now() - started;
          metadata.attemptRecords = attemptRecords;

          return (await this.decodeSuccess(spec, input, response, metadata)) as T;
        }

        lastError = await this.errorOf(response, metadata);
        attemptRecords.push({
          attemptNumber, startedAt: attemptStart, elapsed,
          statusCode: response.status,
          errorType: (lastError as EpostixApiError).type,
          retryAfter: metadata.retryAfter, sleptBefore,
        });
      } else {
        lastError = this.transportErrorOf(failure, options?.signal, attemptNumber, started, attemptRecords);

        if (lastError instanceof EpostixCancelledError) throw lastError;

        attemptRecords.push({
          attemptNumber, startedAt: attemptStart, elapsed,
          statusCode: null, errorType: null, retryAfter: null, sleptBefore,
        });
      }

      const decision = classifyAttempt({
        policy,
        retryClass: spec.retryClass,
        attemptNumber,
        remaining: deadline - (this.config.now() - started),
        error: lastError,
        hasIdempotencyKey: idempotencyKey !== null,
        bodyIsReplayable: true,
        bytesWereWritten,
        responseStarted: false,
        random: Math.random,
      });

      if (decision.action === 'stop') {
        exhausted = decision.reason;
        break;
      }

      sleptBefore = Math.max(0, Math.floor(decision.delay));
      await sleep(sleptBefore, options?.signal);
    }

    throw this.finalError(spec, lastError, exhausted, idempotencyKey, bytesWereWritten, attemptNumber, started, attemptRecords);
  }

  private finalError(
    spec: OperationSpec,
    lastError: unknown,
    exhausted: RetriesExhaustedReason | null,
    idempotencyKey: string | null,
    bytesWereWritten: boolean,
    attempts: number,
    started: number,
    attemptRecords: AttemptRecord[],
  ): unknown {
    if (lastError instanceof EpostixApiError) {
      lastError.responseMetadata.retriesExhaustedReason = exhausted;
      lastError.responseMetadata.attempts = attempts;
      lastError.responseMetadata.attemptRecords = attemptRecords;
      return lastError;
    }

    const isMutation = spec.method !== 'GET';

    if (isMutation && bytesWereWritten) {
      const metadata = emptyMetadata();
      metadata.attempts = attempts;
      metadata.elapsed = this.config.now() - started;
      metadata.attemptRecords = attemptRecords;
      metadata.idempotencyKey = idempotencyKey;
      metadata.retriesExhaustedReason = exhausted;

      return new EpostixOutcomeUnknownError(
        spec.id,
        idempotencyKey,
        idempotencyKey !== null && spec.retryClass === 'DeduplicatedAdmission',
        metadata,
        lastError,
      );
    }

    return lastError;
  }

  private resolveIdempotencyKey(spec: OperationSpec, options?: RequestOptions): string | null {
    const supplied = (options as IdempotentRequestOptions | undefined)?.idempotencyKey;

    if (supplied !== undefined) {
      if (!spec.idempotent) {
        throw new EpostixConfigurationError(
          `${spec.id} does not support an idempotency key: the server does not deduplicate this operation`,
        );
      }
      if (supplied.length > IDEMPOTENCY_KEY_MAXIMUM_LENGTH) {
        throw new EpostixConfigurationError(
          `idempotency key must be ${IDEMPOTENCY_KEY_MAXIMUM_LENGTH} characters or fewer`,
        );
      }
      return supplied;
    }

    if (!spec.idempotent) return null;
    if (!this.config.automaticIdempotencyKeys) return null;

    return this.generateIdempotencyKey();
  }

  private serializeBody(input: ExecuteInput): Uint8Array | null {
    if (input.body === undefined) return null;

    const encoded = input.encode ? input.encode.encode(input.body) : input.body;
    return new TextEncoder().encode(JSON.stringify(encoded));
  }

  private attemptSignal(caller: AbortSignal | undefined, timeout: number): { signal: AbortSignal; dispose: () => void } {
    const timer = AbortSignal.timeout(timeout);
    if (!caller) return { signal: timer, dispose: () => {} };

    const combined = AbortSignal.any([caller, timer]);
    return { signal: combined, dispose: () => {} };
  }

  private metadataOf(
    response: Response,
    ctx: { attemptNumber: number; started: number; idempotencyKey: string | null; attemptRecords: AttemptRecord[] },
  ): ResponseMetadata {
    return {
      statusCode: response.status,
      requestId: response.headers.get('x-request-id') ?? response.headers.get('request-id') ?? '',
      rateLimit: rateLimitFrom(response.headers),
      retryAfter: retryAfterFrom(response.headers),
      idempotentReplayed: response.headers.get('idempotent-replayed') === 'true',
      idempotencyKey: ctx.idempotencyKey,
      attempts: ctx.attemptNumber,
      elapsed: this.config.now() - ctx.started,
      attemptRecords: ctx.attemptRecords,
      retriesExhaustedReason: null,
      transportMayHaveRetried: null,
    };
  }

  private async decodeSuccess(
    spec: OperationSpec,
    input: ExecuteInput,
    response: Response,
    metadata: ResponseMetadata,
  ): Promise<unknown> {
    if (spec.empty) {
      await response.arrayBuffer();
      return attachMetadata({}, metadata);
    }

    const text = await response.text();
    if (text.length === 0) return attachMetadata({}, metadata);

    const parsed = JSON.parse(text);
    const decoded = input.decode ? input.decode.decode(parsed) : parsed;

    return attachMetadata(decoded as object, metadata);
  }

  private async errorOf(response: Response, metadata: ResponseMetadata): Promise<EpostixApiError> {
    const text = await response.text();

    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      parsed = undefined;
    }

    if (!isPlainObject(parsed) || typeof parsed.type !== 'string') {
      const snippet = text.slice(0, RAW_BODY_SNIPPET_LIMIT);
      return buildApiError({
        status: response.status,
        type: '',
        apiMessage: response.statusText || 'the server returned a non-JSON error response',
        requestId: metadata.requestId,
        details: [],
        responseMetadata: metadata,
        rawBodySnippet: snippet,
        rawBodyTruncated: text.length > snippet.length,
      });
    }

    return buildApiError({
      status: typeof parsed.status === 'number' ? parsed.status : response.status,
      type: parsed.type,
      apiMessage: typeof parsed.message === 'string' ? parsed.message : '',
      requestId: typeof parsed.request_id === 'string' ? parsed.request_id : metadata.requestId,
      docUrl: typeof parsed.doc_url === 'string' ? parsed.doc_url : undefined,
      details: detailsOf(parsed),
      responseMetadata: metadata,
    });
  }

  private transportErrorOf(
    failure: unknown,
    signal: AbortSignal | undefined,
    attemptNumber: number,
    started: number,
    attemptRecords: AttemptRecord[],
  ): unknown {
    const metadata = emptyMetadata();
    metadata.attempts = attemptNumber;
    metadata.elapsed = this.config.now() - started;
    metadata.attemptRecords = attemptRecords;

    if (signal?.aborted) return new EpostixCancelledError(signal.reason);

    const name = (failure as { name?: string } | undefined)?.name;
    if (name === 'TimeoutError') return new EpostixTimeoutError('read', failure, metadata);
    if (name === 'AbortError') return new EpostixCancelledError(failure);

    return new EpostixTransportError('the request could not be completed', failure, metadata);
  }
}
