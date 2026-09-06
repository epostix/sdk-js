import { createHmac, timingSafeEqual } from 'node:crypto';
import { EpostixWebhookVerificationError } from '../core/errors.ts';
import { decodeEvent } from './events.ts';
import type { EpostixWebhookEvent } from './events.ts';

export const WEBHOOK_HEADER_ID = 'Webhook-Id';
export const WEBHOOK_HEADER_TIMESTAMP = 'Webhook-Timestamp';
export const WEBHOOK_HEADER_SIGNATURE = 'Webhook-Signature';
export const DEFAULT_TOLERANCE_SECONDS = 300;

export interface WebhookDelivery {
  deliveryId: string;
  timestamp: Date;
  matchedSecretIndex: number;
  signatureCount: number;
}

export interface VerifiedWebhook {
  event: EpostixWebhookEvent;
  delivery: WebhookDelivery;
}

export interface VerifierOptions {
  secrets: string[];
  toleranceSeconds?: number;
  clock?: () => Date;
}

export type HeadersLike =
  | Headers
  | Record<string, string | string[] | undefined>;

function headerOf(headers: HeadersLike, name: string): string | null {
  if (typeof (headers as Headers).get === 'function') {
    return (headers as Headers).get(name);
  }

  const bag = headers as Record<string, string | string[] | undefined>;
  const lower = name.toLowerCase();

  for (const key of Object.keys(bag)) {
    if (key.toLowerCase() !== lower) continue;
    const value = bag[key];
    return Array.isArray(value) ? (value[0] ?? null) : (value ?? null);
  }

  return null;
}

function parseSignatureHeader(raw: string): { timestamp: number; signatures: string[] } | null {
  const signatures: string[] = [];
  let timestamp: number | null = null;

  for (const part of raw.split(',')) {
    const separator = part.indexOf('=');
    if (separator < 0) return null;

    const key = part.slice(0, separator).trim();
    const value = part.slice(separator + 1).trim();

    if (key === 't') {
      const parsed = Number.parseInt(value, 10);
      if (!Number.isFinite(parsed)) return null;
      timestamp = parsed;
      continue;
    }

    if (key === 'v1') signatures.push(value);
  }

  if (timestamp === null || signatures.length === 0) return null;

  return { timestamp, signatures };
}

function constantTimeEquals(a: string, b: string): boolean {
  if (a.length !== b.length) return false;

  const left = Buffer.from(a, 'utf8');
  const right = Buffer.from(b, 'utf8');

  return timingSafeEqual(left, right);
}

export class EpostixWebhookVerifier {
  private readonly secrets: string[];
  private readonly toleranceSeconds: number;
  private readonly clock: () => Date;

  constructor(options: VerifierOptions) {
    if (options.secrets.length === 0) {
      throw new EpostixWebhookVerificationError(
        'NoMatchingSignature', 'at least one signing secret is required',
      );
    }

    this.secrets = [...options.secrets];
    this.toleranceSeconds = options.toleranceSeconds ?? DEFAULT_TOLERANCE_SECONDS;
    this.clock = options.clock ?? (() => new Date());
  }

  static fromRotation(currentSecret: string, previousSecret: string): EpostixWebhookVerifier {
    return new EpostixWebhookVerifier({ secrets: [currentSecret, previousSecret] });
  }

  static decodeWithoutVerifying(payload: Uint8Array | string): EpostixWebhookEvent {
    return decodeEvent(typeof payload === 'string' ? payload : Buffer.from(payload).toString('utf8'));
  }

  verify(payload: Uint8Array | string, headers: HeadersLike): WebhookDelivery {
    const raw = typeof payload === 'string' ? payload : Buffer.from(payload).toString('utf8');

    const signatureHeader = headerOf(headers, WEBHOOK_HEADER_SIGNATURE);
    if (!signatureHeader) {
      throw new EpostixWebhookVerificationError(
        'MissingSignatureHeader', `${WEBHOOK_HEADER_SIGNATURE} is missing`,
      );
    }

    const timestampHeader = headerOf(headers, WEBHOOK_HEADER_TIMESTAMP);
    if (!timestampHeader) {
      throw new EpostixWebhookVerificationError(
        'MissingTimestampHeader', `${WEBHOOK_HEADER_TIMESTAMP} is missing`,
      );
    }

    const parsed = parseSignatureHeader(signatureHeader);
    if (!parsed) {
      throw new EpostixWebhookVerificationError(
        'MalformedSignatureHeader', `${WEBHOOK_HEADER_SIGNATURE} is not in the form t=...,v1=...`,
      );
    }

    if (String(parsed.timestamp) !== timestampHeader.trim()) {
      throw new EpostixWebhookVerificationError(
        'MalformedSignatureHeader',
        `${WEBHOOK_HEADER_TIMESTAMP} and the signed timestamp disagree`,
      );
    }

    const now = Math.floor(this.clock().getTime() / 1000);
    if (Math.abs(now - parsed.timestamp) > this.toleranceSeconds) {
      throw new EpostixWebhookVerificationError(
        'TimestampOutOfTolerance',
        `the signature timestamp is outside the ${this.toleranceSeconds} second tolerance`,
      );
    }

    let matchedSecretIndex = -1;

    for (let index = 0; index < this.secrets.length; index += 1) {
      const expected = createHmac('sha256', this.secrets[index])
        .update(`${parsed.timestamp}.${raw}`)
        .digest('hex');

      for (const candidate of parsed.signatures) {
        if (constantTimeEquals(expected, candidate) && matchedSecretIndex < 0) {
          matchedSecretIndex = index;
        }
      }
    }

    if (matchedSecretIndex < 0) {
      throw new EpostixWebhookVerificationError(
        'NoMatchingSignature', 'no configured secret produced a matching signature',
      );
    }

    return {
      deliveryId: headerOf(headers, WEBHOOK_HEADER_ID) ?? '',
      timestamp: new Date(parsed.timestamp * 1000),
      matchedSecretIndex,
      signatureCount: parsed.signatures.length,
    };
  }

  verifyAndDecode(payload: Uint8Array | string, headers: HeadersLike): VerifiedWebhook {
    const delivery = this.verify(payload, headers);
    const raw = typeof payload === 'string' ? payload : Buffer.from(payload).toString('utf8');

    let event: EpostixWebhookEvent;
    try {
      event = decodeEvent(raw);
    } catch (error) {
      throw new EpostixWebhookVerificationError(
        'MalformedPayload', 'the signature verified but the payload is not valid JSON',
      );
    }

    return { event, delivery };
  }
}
