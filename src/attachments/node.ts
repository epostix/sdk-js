import { readFile } from 'node:fs/promises';
import { basename } from 'node:path';
import { attachment } from './index.ts';
import type { AttachmentDisposition, InlineAttachment } from './index.ts';

export async function fromFile(
  path: string,
  extra: {
    filename?: string;
    contentType?: string;
    disposition?: AttachmentDisposition;
    contentId?: string;
  } = {},
): Promise<InlineAttachment> {
  const bytes = await readFile(path);

  return attachment.fromBytes(
    extra.filename ?? basename(path),
    new Uint8Array(bytes),
    extra.contentType ?? 'application/octet-stream',
    extra,
  );
}
