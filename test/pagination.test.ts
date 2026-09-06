import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Epostix } from '../src/index.ts';
import { EpostixConfigurationError, EpostixPaginationError } from '../src/core/errors.ts';
import { disabledRetryPolicy } from '../src/core/retry.ts';

async function drain<T>(source: AsyncIterable<T>): Promise<T[]> {
  const collected: T[] = [];
  for await (const item of source) collected.push(item);
  return collected;
}

const fixtures = JSON.parse(readFileSync(new URL('./fixtures/pagination.json', import.meta.url), 'utf8'));

function pagedFetch(pages: { body: unknown }[], seen: URL[]): typeof fetch {
  let index = 0;

  return (async (url: string) => {
    seen.push(new URL(String(url)));
    const page = pages[Math.min(index, pages.length - 1)];
    index += 1;
    return new Response(JSON.stringify(page.body), {
      status: 200, headers: { 'content-type': 'application/json' },
    });
  }) as unknown as typeof fetch;
}

function api(pages: { body: unknown }[], seen: URL[]): Epostix {
  return new Epostix({
    apiKey: 'tix_test_abc',
    fetch: pagedFetch(pages, seen),
    retryPolicy: disabledRetryPolicy,
  });
}

for (const testCase of fixtures.cases) {
  test(`pagination: ${testCase.name}`, async () => {
    const seen: URL[] = [];
    const client = api(testCase.pages, seen);
    const iterator = client.emails.listEmailsIterate(testCase.params);

    if (testCase.expect.error) {
      let caught: unknown;
      try {
        await drain(iterator);
      } catch (error) {
        caught = error;
      }

      assert.ok(caught instanceof EpostixPaginationError, 'expected a pagination error');
      assert.equal(caught.reason, testCase.expect.error);
      return;
    }

    if (testCase.maximumItems !== undefined) {
      const collected = await iterator.collect(testCase.maximumItems);
      assert.deepEqual(collected.items.map((i: { id: string }) => i.id), testCase.expect.items);
      assert.equal(collected.truncated, testCase.expect.truncated);
      assert.equal(seen.length, testCase.expect.requests);
      return;
    }

    const ids: string[] = [];
    for await (const item of iterator) {
      ids.push((item as { id: string }).id);
      if (testCase.breakAfter !== undefined && ids.length >= testCase.breakAfter) break;
    }

    assert.deepEqual(ids, testCase.expect.items);
    assert.equal(seen.length, testCase.expect.requests);

    if (testCase.pages[1]?.query?.starting_after) {
      assert.equal(seen[1].searchParams.get('starting_after'), testCase.pages[1].query.starting_after);
    }

    for (const [key, value] of Object.entries(testCase.pages[0].query ?? {})) {
      if (key === 'limit') continue;
      assert.equal(seen[0].searchParams.get(key), value, `filter ${key} must persist`);
    }
  });
}

test('pagination: filters persist on every page, not just the first', async () => {
  const seen: URL[] = [];
  const client = api([
    { body: { data: [{ id: 'e1' }], has_more: true, next_cursor: 'e1' } },
    { body: { data: [{ id: 'e2' }], has_more: false } },
  ], seen);

  const ids: string[] = [];
  for await (const item of client.emails.listEmailsIterate({ status: 'delivered', limit: 1 })) {
    ids.push((item as { id: string }).id);
  }

  assert.deepEqual(ids, ['e1', 'e2']);
  assert.equal(seen[1].searchParams.get('status'), 'delivered');
  assert.equal(seen[1].searchParams.get('starting_after'), 'e1');
});

test('pagination: collect requires an explicit cap', async () => {
  const seen: URL[] = [];
  const client = api([{ body: { data: [], has_more: false } }], seen);

  await assert.rejects(
    () => client.emails.listEmailsIterate({}).collect(0),
    EpostixConfigurationError,
  );
});

test('pagination: ending_before is rejected on an iterator', () => {
  const seen: URL[] = [];
  const client = api([{ body: { data: [], has_more: false } }], seen);

  assert.throws(
    () => client.emails.listEmailsIterate({ endingBefore: 'e9' }),
    EpostixConfigurationError,
  );
});

test('pagination: a stuck cursor is caught on the second request, not the third', async () => {
  const seen: URL[] = [];
  const client = api([
    { body: { data: [{ id: 'e1' }], has_more: true, next_cursor: 'STUCK' } },
  ], seen);

  let caught: unknown;
  try {
    await drain(client.emails.listEmailsIterate({}));
  } catch (error) {
    caught = error;
  }

  assert.ok(caught instanceof EpostixPaginationError);
  assert.equal(caught.reason, 'RepeatedCursor');
  assert.equal(seen.length, 2, 'a server echoing its own cursor must cost exactly one wasted request');
});

test('pagination: template versions expose no iterator at all', () => {
  const seen: URL[] = [];
  const client = api([{ body: { data: [], has_more: false } }], seen);

  assert.equal(typeof (client.templates.versions as never as Record<string, unknown>).listTemplateVersions, 'function');
});
