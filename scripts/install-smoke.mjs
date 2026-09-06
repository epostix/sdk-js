import Epostix, { attachment, EpostixValidationError } from '@epostix/sdk';
import { EpostixWebhookVerifier } from '@epostix/sdk/webhooks';

const client = new Epostix({ apiKey: 'tix_test_smoke' });

if (typeof client.emails.sendEmail !== 'function') throw new Error('emails.sendEmail is missing');
if (typeof client.templates.versions.listTemplateVersions !== 'function') throw new Error('nested resource is missing');
if (typeof attachment.fromBytes !== 'function') throw new Error('attachment helper is missing');
if (typeof EpostixWebhookVerifier !== 'function') throw new Error('webhook verifier is missing');
if (typeof EpostixValidationError !== 'function') throw new Error('error class is missing');

console.log('esm install smoke ok');
