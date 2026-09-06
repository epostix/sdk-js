import type { Codec } from './codec.ts';
import { EpostixConfigurationError, EpostixPaginationError } from './errors.ts';
import type { ResponseMetadata } from './response.ts';
import type { EpostixTransport, OperationSpec, RequestOptions } from './transport.ts';

const MAXIMUM_PAGES = 10_000;

export interface Page<T> {
  data: T[];
  hasMore: boolean;
  nextCursor: string | null;
  continuationUnavailable: boolean;
  responseMetadata: ResponseMetadata;
}

export interface Collection<T> {
  items: T[];
  truncated: boolean;
  lastCursor: string | null;
}

export interface PaginateInput {
  path?: readonly string[];
  query?: object | undefined;
  decode: Codec<unknown>;
  cursorParam: string;
}

export interface PageIterator<T> extends AsyncIterable<T> {
  pages(): AsyncIterable<Page<T>>;
  collect(maximumItems: number): Promise<Collection<T>>;
}

interface RawPage {
  data: unknown[];
  has_more: boolean;
  next_cursor?: string;
}

export function paginate<T>(
  transport: EpostixTransport,
  spec: OperationSpec,
  input: PaginateInput,
  options?: RequestOptions,
): PageIterator<T> {
  const frozen: Record<string, unknown> = input.query
    ? { ...(input.query as Record<string, unknown>) }
    : {};

  if ('endingBefore' in frozen && frozen.endingBefore !== undefined) {
    throw new EpostixConfigurationError(
      `${spec.id}: ending_before cannot be used with an iterator, which walks forward only. ` +
        'Use the single-page method instead.',
    );
  }

  async function* pageStream(): AsyncGenerator<Page<T>> {
    let cursor: string | undefined;
    let pageCount = 0;

    for (;;) {
      pageCount += 1;
      if (pageCount > MAXIMUM_PAGES) {
        throw new EpostixPaginationError(
          'PageLimitExceeded', spec.id,
          `${spec.id}: stopped after ${MAXIMUM_PAGES} pages`,
        );
      }

      const query: Record<string, unknown> = { ...frozen };
      if (cursor !== undefined) query[input.cursorParam] = cursor;

      const raw = (await transport.execute(spec, { path: input.path, query }, options)) as unknown as RawPage & {
        data: unknown[];
      };

      const metadata = (raw as unknown as Record<symbol, ResponseMetadata>)[
        Symbol.for('epostix.responseMetadata')
      ];

      const items = (raw.data ?? []).map((item) => input.decode.decode(item)) as T[];
      const nextCursor = raw.next_cursor ?? null;

      yield {
        data: items,
        hasMore: raw.has_more === true,
        nextCursor,
        continuationUnavailable: raw.has_more === true && nextCursor === null,
        responseMetadata: metadata,
      };

      if (raw.has_more !== true) return;

      if (nextCursor === null) {
        throw new EpostixPaginationError(
          'MissingCursor', spec.id,
          `${spec.id}: the server reported more results but returned no cursor`,
        );
      }

      if (cursor !== undefined && nextCursor === cursor) {
        throw new EpostixPaginationError(
          'RepeatedCursor', spec.id,
          `${spec.id}: the server returned the same cursor it was given`,
        );
      }

      cursor = nextCursor;
    }
  }

  const iterator: PageIterator<T> = {
    async *[Symbol.asyncIterator]() {
      for await (const page of pageStream()) {
        for (const item of page.data) yield item;
      }
    },
    pages: () => pageStream(),
    async collect(maximumItems: number): Promise<Collection<T>> {
      if (!Number.isInteger(maximumItems) || maximumItems <= 0) {
        throw new EpostixConfigurationError('collect requires a positive maximumItems');
      }

      const items: T[] = [];
      let lastCursor: string | null = null;

      for await (const page of pageStream()) {
        lastCursor = page.nextCursor;

        for (const item of page.data) {
          if (items.length >= maximumItems) return { items, truncated: true, lastCursor };
          items.push(item);
        }

        if (items.length >= maximumItems && page.hasMore) {
          return { items, truncated: true, lastCursor };
        }
      }

      return { items, truncated: false, lastCursor };
    },
  };

  return iterator;
}
