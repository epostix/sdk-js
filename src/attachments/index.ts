import { EpostixConfigurationError } from '../core/errors.ts';

export const ATTACHMENT_DECODED_LIMIT_BYTES = 41_943_040;
export const REQUEST_BODY_LIMIT_BYTES = 52_428_800;

export type AttachmentDisposition = 'attachment' | 'inline';

export interface InlineAttachment {
  filename: string;
  content: string;
  contentType: string;
  contentDisposition?: AttachmentDisposition;
  contentId?: string;
}

export interface AttachmentReference {
  attachmentId: string;
}

export interface RemoteAttachment {
  filename: string;
  contentUrl: string;
  contentType?: string;
}

export class EpostixAttachmentTooLargeError extends EpostixConfigurationError {
  readonly filename: string;
  readonly actualBytes: number;
  readonly limitBytes: number;

  constructor(filename: string, actualBytes: number, limitBytes: number) {
    super(
      `attachment "${filename}" is ${actualBytes} bytes, above the ${limitBytes} byte decoded limit`,
    );
    this.filename = filename;
    this.actualBytes = actualBytes;
    this.limitBytes = limitBytes;
  }
}

export class EpostixRequestTooLargeError extends EpostixConfigurationError {
  readonly projectedEncodedBytes: number;
  readonly limitBytes: number;
  readonly attachmentCount: number;

  constructor(projectedEncodedBytes: number, limitBytes: number, attachmentCount: number) {
    super(
      `${attachmentCount} attachment(s) encode to about ${projectedEncodedBytes} bytes, ` +
        `above the ${limitBytes} byte request limit. Upload them first, or pass a content URL.`,
    );
    this.projectedEncodedBytes = projectedEncodedBytes;
    this.limitBytes = limitBytes;
    this.attachmentCount = attachmentCount;
  }
}

export function projectEncodedSize(decodedBytes: number): number {
  return Math.ceil(decodedBytes / 3) * 4;
}

export function assertWithinLimits(sizes: { filename: string; bytes: number }[]): void {
  let total = 0;

  for (const entry of sizes) {
    if (entry.bytes > ATTACHMENT_DECODED_LIMIT_BYTES) {
      throw new EpostixAttachmentTooLargeError(
        entry.filename, entry.bytes, ATTACHMENT_DECODED_LIMIT_BYTES,
      );
    }
    total += entry.bytes;
  }

  const projected = projectEncodedSize(total);
  if (projected > REQUEST_BODY_LIMIT_BYTES) {
    throw new EpostixRequestTooLargeError(projected, REQUEST_BODY_LIMIT_BYTES, sizes.length);
  }
}

function toBase64(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString('base64');
}

export const attachment = {
  fromBytes(
    filename: string,
    bytes: Uint8Array,
    contentType: string,
    extra: { disposition?: AttachmentDisposition; contentId?: string } = {},
  ): InlineAttachment {
    assertWithinLimits([{ filename, bytes: bytes.byteLength }]);

    return {
      filename,
      content: toBase64(bytes),
      contentType,
      ...(extra.disposition ? { contentDisposition: extra.disposition } : {}),
      ...(extra.contentId ? { contentId: extra.contentId } : {}),
    };
  },

  async fromBlob(
    filename: string,
    blob: Blob,
    extra: { contentType?: string; disposition?: AttachmentDisposition; contentId?: string } = {},
  ): Promise<InlineAttachment> {
    const bytes = new Uint8Array(await blob.arrayBuffer());

    return attachment.fromBytes(
      filename,
      bytes,
      extra.contentType ?? blob.type ?? 'application/octet-stream',
      extra,
    );
  },

  fromUploadedId(attachmentId: string): AttachmentReference {
    return { attachmentId };
  },

  fromRemoteUrl(filename: string, contentUrl: string, extra: { contentType?: string } = {}): RemoteAttachment {
    return {
      filename,
      contentUrl,
      ...(extra.contentType ? { contentType: extra.contentType } : {}),
    };
  },
};
