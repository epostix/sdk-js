import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { EpostixWebhookVerifier } from '../src/webhooks/verify.ts';
import {
  isEmailDeliveryEvent, isInboundEmailEvent, isUnknownWebhookEvent, isWebhookTestEvent,
} from '../src/webhooks/events.ts';
import { EpostixWebhookVerificationError } from '../src/core/errors.ts';

const fixtures = JSON.parse(readFileSync(new URL('./fixtures/webhook.json', import.meta.url), 'utf8'));

const variantCheck: Record<string, (event: never) => boolean> = {
  EmailDeliveryEvent: isEmailDeliveryEvent as never,
  InboundEmailEvent: isInboundEmailEvent as never,
  WebhookTestEvent: isWebhookTestEvent as never,
  UnknownWebhookEvent: isUnknownWebhookEvent as never,
};

for (const testCase of fixtures.cases) {
  test(`webhook: ${testCase.name}`, () => {
    const verifier = new EpostixWebhookVerifier({
      secrets: testCase.secrets,
      toleranceSeconds: fixtures.toleranceSeconds,
      clock: () => new Date(fixtures.now * 1000),
    });

    const headers: Record<string, string> = {
      'Webhook-Timestamp': String(testCase.headerTimestamp ?? testCase.ts),
      'Webhook-Id': testCase.deliveryId ?? 'whl_1',
    };

    if (testCase.signature !== null) headers['Webhook-Signature'] = testCase.signature;

    if (!testCase.expect.valid) {
      let caught: unknown;
      try {
        verifier.verifyAndDecode(testCase.payload, headers);
      } catch (error) {
        caught = error;
      }

      assert.ok(caught instanceof EpostixWebhookVerificationError, 'expected a verification error');
      assert.equal(caught.reason, testCase.expect.reason);
      return;
    }

    const verified = verifier.verifyAndDecode(testCase.payload, headers);

    if (testCase.expect.eventType) assert.equal(verified.event.type, testCase.expect.eventType);
    if (testCase.expect.eventId) assert.equal(verified.event.id, testCase.expect.eventId);
    if (testCase.expect.deliveryId) assert.equal(verified.delivery.deliveryId, testCase.expect.deliveryId);

    if (testCase.expect.matchedSecretIndex !== undefined) {
      assert.equal(verified.delivery.matchedSecretIndex, testCase.expect.matchedSecretIndex);
    }

    if (testCase.expect.variant) {
      const check = variantCheck[testCase.expect.variant];
      assert.ok(check(verified.event as never), `expected variant ${testCase.expect.variant}`);
    }
  });
}

test('webhook: the signed event id is the deduplication key, not the header id', () => {
  const valid = fixtures.cases.find((c: { name: string }) => c.name === 'delivery_id_is_not_signed_and_not_the_dedup_key');

  const verifier = new EpostixWebhookVerifier({
    secrets: valid.secrets,
    clock: () => new Date(fixtures.now * 1000),
  });

  const verified = verifier.verifyAndDecode(valid.payload, {
    'Webhook-Timestamp': String(valid.ts),
    'Webhook-Signature': valid.signature,
    'Webhook-Id': 'whl_999',
  });

  assert.equal(verified.event.id, 'evt_1');
  assert.equal(verified.delivery.deliveryId, 'whl_999');
  assert.notEqual(verified.event.id, verified.delivery.deliveryId);
});
