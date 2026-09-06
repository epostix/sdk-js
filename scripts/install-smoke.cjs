const mod = require('@epostix/sdk');
const webhooks = require('@epostix/sdk/webhooks');

const client = new mod.Epostix({ apiKey: 'tix_test_smoke' });

if (typeof client.emails.sendEmail !== 'function') throw new Error('emails.sendEmail is missing');
if (typeof webhooks.EpostixWebhookVerifier !== 'function') throw new Error('webhook verifier is missing');

console.log('cjs install smoke ok');
