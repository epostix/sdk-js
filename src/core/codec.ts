import { isPlainObject } from './json.ts';

export interface Codec<T> {
  encode(value: T): unknown;
  decode(value: unknown): T;
}

export interface FieldSpec {
  wire: string;
  name: string;
  codec: () => Codec<unknown>;
  required: boolean;
  nullable: boolean;
}

export const UNKNOWN_FIELDS = Symbol.for('epostix.unknownFields');

export const passthrough: Codec<unknown> = {
  encode: (value) => value,
  decode: (value) => value,
};

export const dateTime: Codec<unknown> = {
  encode: (value) => {
    if (value instanceof Date) return value.toISOString();
    return value;
  },
  decode: (value) => (typeof value === 'string' ? new Date(value) : value),
};

export function arrayOf(inner: Codec<unknown>): Codec<unknown> {
  return {
    encode: (value) => (Array.isArray(value) ? value.map((v) => inner.encode(v)) : value),
    decode: (value) => (Array.isArray(value) ? value.map((v) => inner.decode(v)) : value),
  };
}

export function mapOf(inner: Codec<unknown>): Codec<unknown> {
  return {
    encode: (value) => {
      if (!isPlainObject(value)) return value;
      const out: Record<string, unknown> = {};
      for (const key of Object.keys(value)) out[key] = inner.encode(value[key]);
      return out;
    },
    decode: (value) => {
      if (!isPlainObject(value)) return value;
      const out: Record<string, unknown> = {};
      for (const key of Object.keys(value)) out[key] = inner.decode(value[key]);
      return out;
    },
  };
}

export function encodeObject(value: Record<string, unknown>, fields: FieldSpec[]): unknown {
  const out: Record<string, unknown> = {};

  for (const field of fields) {
    if (!Object.prototype.hasOwnProperty.call(value, field.name)) continue;

    const raw = value[field.name];
    if (raw === undefined) continue;

    out[field.wire] = raw === null ? null : field.codec().encode(raw);
  }

  return out;
}

export function decodeObject(value: unknown, fields: FieldSpec[]): Record<string, unknown> {
  if (!isPlainObject(value)) return value as Record<string, unknown>;

  const out: Record<string, unknown> = {};
  const known = new Set(fields.map((f) => f.wire));

  for (const field of fields) {
    if (!Object.prototype.hasOwnProperty.call(value, field.wire)) continue;

    const raw = value[field.wire];
    out[field.name] = raw === null ? null : field.codec().decode(raw);
  }

  const unknown: Record<string, unknown> = {};
  let hasUnknown = false;

  for (const key of Object.keys(value)) {
    if (known.has(key)) continue;
    unknown[key] = value[key];
    hasUnknown = true;
  }

  if (hasUnknown) {
    Object.defineProperty(out, UNKNOWN_FIELDS, {
      value: unknown,
      enumerable: false,
      writable: false,
      configurable: true,
    });
  }

  return out;
}

export function unknownFieldsOf(value: object): Record<string, unknown> | undefined {
  return (value as Record<symbol, unknown>)[UNKNOWN_FIELDS] as Record<string, unknown> | undefined;
}
