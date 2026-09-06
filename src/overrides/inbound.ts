import { EpostixConfigurationError } from '../core/errors.ts';
import type { EpostixTransport, RequestOptions } from '../core/transport.ts';
import type { ResponseMetadata } from '../core/response.ts';
import { operations } from '../generated/operations.ts';

export interface RawContent {
  body: ReadableStream<Uint8Array>;
  contentType: string;
  responseMetadata: ResponseMetadata;
}

export async function getInboundEmailRaw(
  transport: EpostixTransport,
  inboundId: string,
  options?: RequestOptions,
): Promise<RawContent> {
  const raw = await transport.executeRaw(operations.getInboundEmailRaw, { path: [inboundId] }, options);

  if (!raw.body) {
    throw new EpostixConfigurationError('the server returned no body for the raw message');
  }

  return {
    body: raw.body,
    contentType: raw.headers.get('content-type') ?? 'message/rfc822',
    responseMetadata: raw.responseMetadata,
  };
}

export async function getInboundEmailRawBytes(
  transport: EpostixTransport,
  inboundId: string,
  maximumBytes: number,
  options?: RequestOptions,
): Promise<Uint8Array> {
  if (!Number.isInteger(maximumBytes) || maximumBytes <= 0) {
    throw new EpostixConfigurationError('getInboundEmailRawBytes requires a positive maximumBytes');
  }

  const raw = await getInboundEmailRaw(transport, inboundId, options);
  const reader = raw.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;

    total += value.byteLength;

    if (total > maximumBytes) {
      await reader.cancel();
      throw new EpostixConfigurationError(
        `the raw message is larger than the ${maximumBytes} byte cap you set`,
      );
    }

    chunks.push(value);
  }

  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.byteLength;
  }

  return out;
}
