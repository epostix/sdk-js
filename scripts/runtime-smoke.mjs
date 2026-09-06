import Epostix, { defaultRetryPolicy } from '../dist/esm/index.js';

const client = new Epostix({ apiKey: 'tix_test_smoke' });

if (typeof client.emails.sendEmail !== 'function') throw new Error('emails.sendEmail is missing');
if (client.keyEnvironment !== 'test') throw new Error('key environment was not derived');
if (defaultRetryPolicy.maximumRetries !== 2) throw new Error('retry policy did not load');

console.log('runtime smoke ok');
