import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Epostix } from '../src/index.ts';
import { EpostixAttachmentTooLargeError, ATTACHMENT_DECODED_LIMIT_BYTES } from '../src/attachments/index.ts';
import { EpostixConfigurationError } from '../src/core/errors.ts';
import { disabledRetryPolicy } from '../src/core/retry.ts';

interface Seen {
  url: string;
  headers: Record<string, string>;
}

function client(seen: Seen[], body: Uint8Array, status = 200): Epostix {
  const fetchImpl = (async (url: string, init: RequestInit) => {
    seen.push({ url: String(url), headers: init.headers as Record<string, string> });
    return new Response(body as unknown as BodyInit, { status, headers: { 'content-type': 'message/rfc822' } });
  }) as unknown as typeof fetch;

  return new Epostix({ apiKey: 'tix_test_x', fetch: fetchImpl, retryPolicy: disabledRetryPolicy });
}

test('the raw inbound path carries no idempotency key', async () => {
  const seen: Seen[] = [];
  const api = client(seen, new TextEncoder().encode('From: a@b\r\n\r\nbody'));

  await api.inbound.getInboundEmailRawBytes('inb_1', 1000);

  assert.equal(seen[0].headers.accept, '*/*');
  assert.equal(seen[0].headers['idempotency-key'], undefined,
    'a streaming GET must not carry an idempotency key');
});

test('the raw byte cap is required and enforced', async () => {
  const seen: Seen[] = [];
  const api = client(seen, new Uint8Array(512));

  await assert.rejects(
    () => api.inbound.getInboundEmailRawBytes('inb_1', 0),
    EpostixConfigurationError,
  );

  assert.equal(seen.length, 0, 'a rejected cap must not reach the network');

  await assert.rejects(
    () => api.inbound.getInboundEmailRawBytes('inb_1', 64),
    EpostixConfigurationError,
  );
});

test('an oversize upload never reaches the network', async () => {
  const seen: Seen[] = [];
  const api = client(seen, new Uint8Array(0));

  await assert.rejects(
    () => api.attachments.uploadAttachment(
      'huge.bin', new Uint8Array(ATTACHMENT_DECODED_LIMIT_BYTES + 1), 'application/octet-stream',
    ),
    EpostixAttachmentTooLargeError,
  );

  assert.equal(seen.length, 0, 'the size projection must run before any network call');
});
