import type { JsonValue } from '../core/json.ts';

export const WEBHOOK_EVENT_TYPES = {
  EmailSent: 'email.sent',
  EmailDelivered: 'email.delivered',
  EmailBounced: 'email.bounced',
  EmailOpened: 'email.opened',
  EmailClicked: 'email.clicked',
  EmailComplained: 'email.complained',
  EmailFailed: 'email.failed',
  EmailDelayed: 'email.delayed',
  EmailReceived: 'email.received',
  WebhookTest: 'webhook.test',
} as const;

const DELIVERY_TYPES: ReadonlySet<string> = new Set([
  'email.sent', 'email.delivered', 'email.bounced', 'email.opened',
  'email.clicked', 'email.complained', 'email.failed', 'email.delayed',
]);

export interface EmailDeliveryEvent {
  id: string;
  type: string;
  createdAt: Date;
  emailId: string;
  data: Record<string, JsonValue>;
}

export interface InboundEmailEvent {
  id: string;
  type: 'email.received';
  createdAt: Date;
  inboundId: string;
  data: Record<string, JsonValue>;
}

export interface WebhookTestEvent {
  id: string;
  type: 'webhook.test';
  createdAt: Date;
  message: string;
  data: Record<string, JsonValue>;
}

export interface UnknownWebhookEvent {
  id: string;
  type: string;
  createdAt: Date;
  data: JsonValue;
  rawBody: string;
}

export type EpostixWebhookEvent =
  | EmailDeliveryEvent
  | InboundEmailEvent
  | WebhookTestEvent
  | UnknownWebhookEvent;

export function isEmailDeliveryEvent(event: EpostixWebhookEvent): event is EmailDeliveryEvent {
  return DELIVERY_TYPES.has(event.type);
}

export function isInboundEmailEvent(event: EpostixWebhookEvent): event is InboundEmailEvent {
  return event.type === WEBHOOK_EVENT_TYPES.EmailReceived;
}

export function isWebhookTestEvent(event: EpostixWebhookEvent): event is WebhookTestEvent {
  return event.type === WEBHOOK_EVENT_TYPES.WebhookTest;
}

export function isUnknownWebhookEvent(event: EpostixWebhookEvent): event is UnknownWebhookEvent {
  return !DELIVERY_TYPES.has(event.type)
    && event.type !== WEBHOOK_EVENT_TYPES.EmailReceived
    && event.type !== WEBHOOK_EVENT_TYPES.WebhookTest;
}

export function decodeEvent(raw: string): EpostixWebhookEvent {
  const parsed = JSON.parse(raw) as Record<string, unknown>;

  const id = String(parsed.id ?? '');
  const type = String(parsed.type ?? '');
  const createdAt = new Date(String(parsed.created_at ?? ''));
  const data = (parsed.data ?? {}) as Record<string, JsonValue>;

  if (DELIVERY_TYPES.has(type)) {
    return { id, type, createdAt, emailId: String(data.email_id ?? ''), data };
  }

  if (type === WEBHOOK_EVENT_TYPES.EmailReceived) {
    return { id, type, createdAt, inboundId: String(data.inbound_id ?? ''), data };
  }

  if (type === WEBHOOK_EVENT_TYPES.WebhookTest) {
    return { id, type, createdAt, message: String(data.message ?? ''), data };
  }

  return { id, type, createdAt, data: data as JsonValue, rawBody: raw };
}
