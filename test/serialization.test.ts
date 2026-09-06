import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { codecEmailCreate, codecEmailUpdate, codecAttachment } from '../src/generated/codecs.ts';

const fixtures = JSON.parse(readFileSync(new URL('./fixtures/serialization.json', import.meta.url), 'utf8'));

const codecs: Record<string, { encode(value: unknown): unknown }> = {
  EmailCreate: codecEmailCreate as never,
  EmailUpdate: codecEmailUpdate as never,
  Attachment: codecAttachment as never,
};

const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/;

function camelize(value: unknown, key?: string): unknown {
  if (Array.isArray(value)) return value.map((item) => camelize(item));

  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase())] = camelize(v, k);
    }
    return out;
  }

  if (typeof value === 'string' && key === 'metadata') return value;
  if (typeof value === 'string' && ISO.test(value)) return new Date(value);

  return value;
}

function toInput(type: string, raw: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(raw)) {
    const camel = key.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase());
    out[camel] = key === 'metadata' ? value : camelize(value, key);
  }

  return out;
}

function sameInstant(actual: unknown, expected: unknown): boolean {
  return typeof actual === 'string' && typeof expected === 'string'
    && ISO.test(actual) && ISO.test(expected)
    && Date.parse(actual) === Date.parse(expected);
}

for (const testCase of fixtures.cases) {
  test(`serialization: ${testCase.name}`, () => {
    const codec = codecs[testCase.type];
    assert.ok(codec, `no codec registered for ${testCase.type}`);

    const encoded = codec.encode(toInput(testCase.type, testCase.input)) as Record<string, unknown>;

    for (const key of testCase.absentKeys ?? []) {
      assert.ok(!(key in encoded), `${key} must be absent from the wire body`);
    }

    for (const [key, expected] of Object.entries(testCase.expected)) {
      if (sameInstant(encoded[key], expected)) continue;
      assert.deepEqual(encoded[key], expected, `field ${key}`);
    }
  });
}
