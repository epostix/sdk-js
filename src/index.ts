import { buildResources } from './generated/index.ts';
import type { Resources } from './generated/index.ts';
import { buildTransport, keyEnvironmentOf } from './core/client.ts';
import type { EpostixOptions, KeyEnvironment } from './core/client.ts';
import type { IdempotentRequestOptions, RequestOptions } from './core/transport.ts';
import type { AttachmentResponse } from './generated/models.ts';
import type { RawContent } from './overrides/inbound.ts';
import type { EpostixTransport } from './core/transport.ts';
import { uploadAttachment } from './overrides/attachments.ts';
import { getInboundEmailRaw, getInboundEmailRawBytes } from './overrides/inbound.ts';

export class Epostix {
  readonly emails: Resources['emails'];
  readonly templates: Resources['templates'];
  readonly attachments: Resources['attachments'] & {
    uploadAttachment(
      filename: string, content: Uint8Array, contentType: string,
      options?: IdempotentRequestOptions,
    ): Promise<AttachmentResponse>;
  };
  readonly domains: Resources['domains'];
  readonly events: Resources['events'];
  readonly inbound: Resources['inbound'] & {
    getInboundEmailRaw(inboundId: string, options?: RequestOptions): Promise<RawContent>;
    getInboundEmailRawBytes(
      inboundId: string, maximumBytes: number, options?: RequestOptions,
    ): Promise<Uint8Array>;
  };
  readonly analytics: Resources['analytics'];
  readonly broadcasts: Resources['broadcasts'];
  readonly contacts: Resources['contacts'];
  readonly tags: Resources['tags'];
  readonly suppressions: Resources['suppressions'];
  readonly webhooks: Resources['webhooks'];
  readonly apiKeys: Resources['apiKeys'];
  readonly keyEnvironment: KeyEnvironment;
  readonly deduplicationScope = 'api_key + environment + method + path + key, 24h';

  private readonly transport: EpostixTransport;
  private readonly options: EpostixOptions;

  constructor(options: EpostixOptions) {
    this.options = options;
    this.transport = buildTransport(options);
    this.keyEnvironment = keyEnvironmentOf(options.apiKey ?? '');

    const resources = buildResources(this.transport);
    this.emails = resources.emails;
    this.templates = resources.templates;
    this.attachments = Object.assign(resources.attachments, {
      uploadAttachment: (
        filename: string,
        content: Uint8Array,
        contentType: string,
        options?: Parameters<typeof uploadAttachment>[4],
      ) => uploadAttachment(this.transport, filename, content, contentType, options),
    });
    this.domains = resources.domains;
    this.events = resources.events;
    this.inbound = Object.assign(resources.inbound, {
      getInboundEmailRaw: (
        inboundId: string,
        options?: Parameters<typeof getInboundEmailRaw>[2],
      ) => getInboundEmailRaw(this.transport, inboundId, options),
      getInboundEmailRawBytes: (
        inboundId: string,
        maximumBytes: number,
        options?: Parameters<typeof getInboundEmailRawBytes>[3],
      ) => getInboundEmailRawBytes(this.transport, inboundId, maximumBytes, options),
    });
    this.analytics = resources.analytics;
    this.broadcasts = resources.broadcasts;
    this.contacts = resources.contacts;
    this.tags = resources.tags;
    this.suppressions = resources.suppressions;
    this.webhooks = resources.webhooks;
    this.apiKeys = resources.apiKeys;
  }

  withApiKey(apiKey: string): Epostix {
    return new Epostix({ ...this.options, apiKey });
  }
}

export default Epostix;

export { PRODUCTION_BASE_URL, STAGING_BASE_URL, keyEnvironmentOf } from './core/client.ts';
export type { EpostixOptions, KeyEnvironment } from './core/client.ts';

export {
  IDEMPOTENCY_KEY_MAXIMUM_LENGTH, IDEMPOTENCY_RETENTION_HOURS,
} from './core/transport.ts';
export type {
  ExecuteInput, IdempotentRequestOptions, OperationSpec, RequestOptions,
} from './core/transport.ts';

export {
  batchRetryPolicy, defaultRetryPolicy, disabledRetryPolicy, uploadRetryPolicy,
} from './core/retry.ts';
export type { MutationRetryMode, RetryClass, RetryPolicy } from './core/retry.ts';

export * from './core/errors.ts';
export { epostixResponseOf } from './core/response.ts';
export type {
  AttemptRecord, RateLimitSnapshot, ResponseMetadata, RetriesExhaustedReason,
} from './core/response.ts';

export { unknownFieldsOf } from './core/codec.ts';
export type { JsonValue } from './core/json.ts';

export type { Collection, Page, PageIterator } from './core/pagination.ts';

export {
  isAccepted, isRejected, isUnresolved, normalizeBatch,
} from './core/batch.ts';
export type {
  AcceptedOutcome, BatchOutcome, BatchResult, RejectedOutcome, UnresolvedOutcome,
} from './core/batch.ts';

export {
  assertWithinLimits, attachment, ATTACHMENT_DECODED_LIMIT_BYTES,
  EpostixAttachmentTooLargeError, EpostixRequestTooLargeError,
  projectEncodedSize, REQUEST_BODY_LIMIT_BYTES,
} from './attachments/index.ts';
export type {
  AttachmentDisposition, AttachmentReference, InlineAttachment, RemoteAttachment,
} from './attachments/index.ts';

export {
  decodeEvent, isEmailDeliveryEvent, isInboundEmailEvent, isUnknownWebhookEvent,
  isWebhookTestEvent, WEBHOOK_EVENT_TYPES,
} from './webhooks/events.ts';
export type {
  EmailDeliveryEvent, EpostixWebhookEvent, InboundEmailEvent, UnknownWebhookEvent,
  WebhookTestEvent,
} from './webhooks/events.ts';

export type { RawContent } from './overrides/inbound.ts';

export * from './generated/models.ts';
