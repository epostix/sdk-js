import { EpostixConfigurationError } from './errors.ts';
import { defaultRetryPolicy } from './retry.ts';
import type { RetryPolicy } from './retry.ts';
import { EpostixTransport } from './transport.ts';
import type { AttemptRecord } from './response.ts';

export const PRODUCTION_BASE_URL = 'https://api.epostix.com/v1';
export const STAGING_BASE_URL = 'https://api.staging.epostix.com/v1';

export type KeyEnvironment = 'live' | 'test' | 'unrecognized';

export interface EpostixOptions {
  apiKey: string;
  baseUrl?: string;
  retryPolicy?: RetryPolicy;
  fetch?: typeof fetch;
  defaultHeaders?: Record<string, string>;
  userAgentSuffix?: string;
  automaticIdempotencyKeys?: boolean;
  randomValues?: (size: number) => Uint8Array;
  now?: () => number;
  observer?: (record: AttemptRecord & { operation: string }) => void;
}

export function keyEnvironmentOf(apiKey: string): KeyEnvironment {
  if (apiKey.startsWith('tix_live_')) return 'live';
  if (apiKey.startsWith('tix_test_')) return 'test';
  return 'unrecognized';
}

function validate(options: EpostixOptions): EpostixConfigurationError | undefined {
  const key = options.apiKey;

  if (typeof key !== 'string' || key.trim().length === 0) {
    return new EpostixConfigurationError('an API key is required');
  }

  if (key.startsWith('Bearer ')) {
    return new EpostixConfigurationError(
      'pass the API key alone; the client adds the Bearer prefix itself',
    );
  }

  if (options.baseUrl !== undefined) {
    try {
      new URL(options.baseUrl);
    } catch {
      return new EpostixConfigurationError(`baseUrl is not a valid URL: ${options.baseUrl}`);
    }
  }

  return undefined;
}

export function buildTransport(options: EpostixOptions): EpostixTransport {
  const suffix = options.userAgentSuffix ? ` ${options.userAgentSuffix}` : '';

  return new EpostixTransport({
    apiKey: options.apiKey,
    baseUrl: (options.baseUrl ?? PRODUCTION_BASE_URL).replace(/\/+$/, ''),
    retryPolicy: options.retryPolicy ?? defaultRetryPolicy,
    fetch: options.fetch ?? globalThis.fetch,
    defaultHeaders: options.defaultHeaders ?? {},
    userAgent: `epostix-js/1.0.0${suffix}`,
    automaticIdempotencyKeys: options.automaticIdempotencyKeys ?? true,
    randomValues: options.randomValues ?? ((size) => crypto.getRandomValues(new Uint8Array(size))),
    now: options.now ?? (() => performance.now()),
    observer: options.observer,
    configurationError: validate(options),
  });
}
