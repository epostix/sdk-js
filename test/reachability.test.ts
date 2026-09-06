import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Epostix } from '../src/index.ts';
import { operations } from '../src/generated/operations.ts';

const manifest = JSON.parse(readFileSync(new URL('../.codegen.json', import.meta.url), 'utf8'));

function methodsOf(target: object): Set<string> {
  const names = new Set<string>();

  for (let proto = target; proto && proto !== Object.prototype; proto = Object.getPrototypeOf(proto)) {
    for (const name of Object.getOwnPropertyNames(proto)) names.add(name.toLowerCase());
  }

  for (const name of Object.keys(target)) names.add(name.toLowerCase());

  return names;
}

test('every operation in the spec is reachable from the client', () => {
  const client = new Epostix({ apiKey: 'tix_test_x' });

  const reachable = new Set<string>();

  for (const key of Object.keys(client) as (keyof Epostix)[]) {
    const resource = client[key];
    if (typeof resource !== 'object' || resource === null) continue;

    for (const name of methodsOf(resource)) reachable.add(name);

    for (const nested of Object.keys(resource)) {
      const child = (resource as unknown as Record<string, unknown>)[nested];
      if (typeof child !== 'object' || child === null) continue;
      for (const name of methodsOf(child)) reachable.add(name);
    }
  }

  const missing = Object.keys(operations).filter((id) => !reachable.has(id.toLowerCase()));

  assert.deepEqual(missing, [], `unreachable operations: ${missing.join(', ')}`);
});

test('the operation table covers every operation the generator emitted', () => {
  assert.equal(Object.keys(operations).length, 79);
});

test('only the deduplicated operations accept an idempotency key', () => {
  const idempotent = Object.values(operations).filter((op) => op.idempotent).map((op) => op.id);

  assert.deepEqual(idempotent.sort(), [
    'bulkCreateSuppressions', 'createBroadcast', 'createSuppression', 'createTemplate',
    'createTemplateVersion', 'sendEmail', 'sendEmailBatch',
  ]);

  for (const op of Object.values(operations)) {
    if (op.retryClass !== 'ExcludedMutation') continue;
    assert.equal(op.idempotent, false, `${op.id} mints a credential and must not advertise a key`);
  }
});

test('the vendored spec is the one the generated code was built from', () => {
  assert.equal(typeof manifest.spec.raw_sha256, 'string');
  assert.equal(manifest.spec.raw_sha256.length, 64);
  assert.equal(Object.keys(manifest.files).length, 19);
});
