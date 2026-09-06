import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Epostix } from '../src/index.ts';
import {
  EpostixApiError, EpostixCancelledError, EpostixConfigurationError,
  EpostixIdempotencyConflictError, EpostixOutcomeUnknownError, EpostixQuotaExceededError,
  EpostixRateLimitError, EpostixServerError, EpostixValidationError,
} from '../src/core/errors.ts';
import { epostixResponseOf } from '../src/core/response.ts';
import { disabledRetryPolicy } from '../src/core/retry.ts';

const decoding = JSON.parse(readFileSync(new URL('./fixtures/decoding.json', import.meta.url), 'utf8'));

interface Recorded {
  url: string;
  init: RequestInit;
}

function stubFetch(responses: (Response | Error)[], recorded: Recorded[] = []): typeof fetch {
  let index = 0;

  return (async (url: string, init: RequestInit) => {
    recorded.push({ url: String(url), init });
    const next = responses[Math.min(index, responses.length - 1)];
    index += 1;
    if (next instanceof Error) throw next;
    return next.clone();
  }) as unknown as typeof fetch;
}

function json(status: number, body: unknown, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  });
}

function client(fetchImpl: typeof fetch, options: Record<string, unknown> = {}): Epostix {
  return new Epostix({
    apiKey: 'tix_test_abc',
    fetch: fetchImpl,
    retryPolicy: disabledRetryPolicy,
    ...options,
  });
}

const errorCases = decoding.cases.filter((c: { type: string }) => c.type === 'APIError');

for (const testCase of errorCases) {
  test(`decoding: ${testCase.name}`, async () => {
    const api = client(stubFetch([json(testCase.status, testCase.wire, testCase.headers ?? {})]));

    let caught: unknown;
    try {
      await api.emails.getEmail('eml_1');
    } catch (error) {
      caught = error;
    }

    assert.ok(caught instanceof EpostixApiError, 'expected an API error');
    assert.equal(caught.type, testCase.wire.type);

    if (testCase.expect.isKnownType !== undefined) {
      assert.equal(caught.isKnownType, testCase.expect.isKnownType);
    }

    const expectedClass: Record<string, unknown> = {
      EpostixServerError, EpostixValidationError, EpostixRateLimitError,
      EpostixQuotaExceededError, EpostixIdempotencyConflictError,
    };

    const target = expectedClass[testCase.expect.class];
    if (target) assert.ok(caught instanceof (target as never), `expected ${testCase.expect.class}`);

    if (testCase.expect.retryAfterSeconds !== undefined) {
      const actual = (caught as EpostixRateLimitError).retryAfter ?? null;
      assert.equal(actual, testCase.expect.retryAfterSeconds);
    }

    if (testCase.expect.quotaPeriod) {
      assert.equal((caught as EpostixQuotaExceededError).quotaPeriod, testCase.expect.quotaPeriod);
    }

    if (testCase.expect.fieldErrors !== undefined) {
      assert.equal((caught as EpostixValidationError).fieldErrors.length, testCase.expect.fieldErrors);
    }

    if (testCase.expect.rateLimit) {
      const snapshot = caught.responseMetadata.rateLimit;
      assert.ok(snapshot, 'expected a rate limit snapshot');
      assert.equal(snapshot.limit, testCase.expect.rateLimit.limit);
      assert.equal(snapshot.remaining, testCase.expect.rateLimit.remaining);
      assert.equal(snapshot.policyBurst, testCase.expect.rateLimit.policyBurst);
      assert.equal(snapshot.policyWindow, testCase.expect.rateLimit.policyWindowSeconds);
      assert.equal(snapshot.scope, testCase.expect.rateLimit.scope);
    }
  });
}

test('decoding: a non-JSON proxy failure is bounded and typed', async () => {
  const api = client(stubFetch([
    new Response('<html><body>502 Bad Gateway</body></html>', {
      status: 502, headers: { 'content-type': 'text/html' },
    }),
  ]));

  let caught: unknown;
  try {
    await api.emails.getEmail('eml_1');
  } catch (error) {
    caught = error;
  }

  assert.ok(caught instanceof EpostixServerError);
  assert.equal(caught.type, '');
  assert.equal(caught.isKnownType, false);
  assert.ok(caught.rawBodySnippet?.includes('502 Bad Gateway'));
  assert.ok(!caught.message.includes('<html>'), 'the raw body must not leak into the message');
});

test('decoding: an unknown enum member never fails the response', async () => {
  const api = client(stubFetch([
    json(200, { id: 'eml_1', status: 'quantum_delivered', created_at: '2026-09-06T10:00:00Z' }),
  ]));

  const email = await api.emails.getEmail('eml_1');
  assert.equal(email.status, 'quantum_delivered');
});

test('metadata: the replay header is reachable without a second request', async () => {
  const api = client(stubFetch([
    json(200, { id: 'eml_1', status: 'sent', created_at: '2026-09-06T10:00:00Z' },
      { 'idempotent-replayed': 'true' }),
  ]));

  const email = await api.emails.getEmail('eml_1');
  const metadata = epostixResponseOf(email);

  assert.equal(metadata?.idempotentReplayed, true);
  assert.equal(metadata?.statusCode, 200);
});

test('idempotency: an auto key is attached to a deduplicated send', async () => {
  const recorded: Recorded[] = [];
  const api = client(stubFetch([json(200, { id: 'eml_1' })], recorded));

  await api.emails.sendEmail({ from: 'a@example.com', to: 'b@example.com', subject: 's' });

  const headers = recorded[0].init.headers as Record<string, string>;
  assert.match(headers['idempotency-key'], /^epx_auto_[0-9a-f]{32}$/);
});

test('idempotency: no key is attached to a non-deduplicated operation', async () => {
  const recorded: Recorded[] = [];
  const api = client(stubFetch([json(200, { id: 'dom_1' })], recorded));

  await api.domains.createDomain({ name: 'example.com' } as never);

  const headers = recorded[0].init.headers as Record<string, string>;
  assert.equal(headers['idempotency-key'], undefined);
});

test('idempotency: a key on an excluded operation is rejected before any request', async () => {
  const recorded: Recorded[] = [];
  const api = client(stubFetch([json(201, { id: 'key_1' })], recorded));

  await assert.rejects(
    () => api.apiKeys.createApiKey({ name: 'ci' } as never, { idempotencyKey: 'k' } as never),
    EpostixConfigurationError,
  );

  assert.equal(recorded.length, 0, 'no request may be sent');
});

test('retry: identical bytes and the same key are replayed', async () => {
  const recorded: Recorded[] = [];
  const api = client(
    stubFetch([json(503, { status: 503, type: 'service_unavailable', message: 'x', request_id: 'r' }),
               json(200, { id: 'eml_1' })], recorded),
    { retryPolicy: { ...disabledRetryPolicy, maximumRetries: 2, backoffBase: 1, backoffMaximum: 1 } },
  );

  await api.emails.sendEmail({ from: 'a@example.com', to: 'b@example.com', subject: 's' });

  assert.equal(recorded.length, 2);
  const first = recorded[0].init.headers as Record<string, string>;
  const second = recorded[1].init.headers as Record<string, string>;
  assert.equal(first['idempotency-key'], second['idempotency-key']);
  assert.deepEqual(recorded[0].init.body, recorded[1].init.body);
});

test('retry: a validation failure is never retried', async () => {
  const recorded: Recorded[] = [];
  const api = client(
    stubFetch([json(422, { status: 422, type: 'validation_error', message: 'x', request_id: 'r' })], recorded),
    { retryPolicy: { ...disabledRetryPolicy, maximumRetries: 3, backoffBase: 1 } },
  );

  await assert.rejects(() => api.emails.sendEmail({ from: 'a@example.com', to: 'b@example.com', subject: 's' }));
  assert.equal(recorded.length, 1);
});

test('retry: an idempotency conflict is never retried and no new key is minted', async () => {
  const recorded: Recorded[] = [];
  const api = client(
    stubFetch([json(409, { status: 409, type: 'idempotency_conflict', message: 'x', request_id: 'r' })], recorded),
    { retryPolicy: { ...disabledRetryPolicy, maximumRetries: 3, backoffBase: 1 } },
  );

  await assert.rejects(
    () => api.emails.sendEmail({ from: 'a@example.com', to: 'b@example.com', subject: 's' }),
    EpostixIdempotencyConflictError,
  );

  assert.equal(recorded.length, 1);
});

test('retry: a daily quota failure never sleeps to midnight', async () => {
  const started = Date.now();
  const api = client(
    stubFetch([json(429, { status: 429, type: 'daily_quota_exceeded', message: 'x', request_id: 'r' },
      { 'retry-after': '31200' })]),
    { retryPolicy: { ...disabledRetryPolicy, maximumRetries: 3, backoffBase: 1 } },
  );

  let caught: unknown;
  try {
    await api.emails.sendEmail({ from: 'a@example.com', to: 'b@example.com', subject: 's' });
  } catch (error) {
    caught = error;
  }

  assert.ok(caught instanceof EpostixQuotaExceededError);
  assert.equal(caught.quotaPeriod, 'daily');
  assert.ok(Date.now() - started < 2000, 'the SDK must not sleep the retry-after');
});

test('retry: a lost response after a send reports an unknown outcome', async () => {
  const api = client(
    stubFetch([new TypeError('socket hang up')]),
    { retryPolicy: { ...disabledRetryPolicy, maximumRetries: 0 } },
  );

  let caught: unknown;
  try {
    await api.emails.sendEmail({ from: 'a@example.com', to: 'b@example.com', subject: 's' });
  } catch (error) {
    caught = error;
  }

  assert.ok(caught instanceof EpostixOutcomeUnknownError, 'expected an unknown outcome');
  assert.equal(caught.operation, 'sendEmail');
  assert.equal(caught.replayableWithKey, true);
});

test('cancellation: an aborted signal stops before any request', async () => {
  const recorded: Recorded[] = [];
  const controller = new AbortController();
  controller.abort();

  const api = client(stubFetch([json(200, {})], recorded));

  await assert.rejects(
    () => api.emails.getEmail('eml_1', { signal: controller.signal }),
    EpostixCancelledError,
  );

  assert.equal(recorded.length, 0);
});

test('configuration: a key passed with a Bearer prefix is rejected', async () => {
  const api = new Epostix({ apiKey: 'Bearer tix_live_x', fetch: stubFetch([json(200, {})]) });
  await assert.rejects(() => api.emails.getEmail('eml_1'), EpostixConfigurationError);
});

test('configuration: the key environment is readable without a network call', () => {
  assert.equal(new Epostix({ apiKey: 'tix_live_x' }).keyEnvironment, 'live');
  assert.equal(new Epostix({ apiKey: 'tix_test_x' }).keyEnvironment, 'test');
  assert.equal(new Epostix({ apiKey: 'tix_x' }).keyEnvironment, 'unrecognized');
});
