import { assertWithinLimits } from '../attachments/index.ts';
import type { EpostixTransport, IdempotentRequestOptions } from '../core/transport.ts';
import { operations } from '../generated/operations.ts';
import * as codecs from '../generated/codecs.ts';
import type * as models from '../generated/models.ts';

export async function uploadAttachment(
  transport: EpostixTransport,
  filename: string,
  content: Uint8Array,
  contentType: string,
  options?: IdempotentRequestOptions,
): Promise<models.AttachmentResponse> {
  assertWithinLimits([{ filename, bytes: content.byteLength }]);

  const body: models.AttachmentUpload = {
    filename,
    content: Buffer.from(content).toString('base64'),
    contentType,
  };

  return transport.execute(operations.uploadAttachment, {
    body,
    encode: codecs.codecAttachmentUpload,
    decode: codecs.codecAttachmentResponse,
  }, options);
}
