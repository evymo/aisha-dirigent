/**
 * Validation engine (R1/R4) — ajv strict over @aisha/acs-contracts.
 * A message that does not validate DOES NOT EXIST for the pipeline:
 * callers receive a structured rejection, never a coerced object.
 */
import { createRequire } from 'node:module';
import { Ajv2020 } from 'ajv/dist/2020.js';
import type { ValidateFunction } from 'ajv';
import type { FormatsPlugin } from 'ajv-formats';
import { getSchema, SCHEMA_REFS, type AcsMessage, type SchemaRef } from '@aisha/acs-contracts';
import { ULID_PATTERN } from './ulid.js';

// CJS interop that works under BOTH NodeNext emit and vitest/esbuild:
// runtime objects come from createRequire; the named class import above is
// used purely as a type and is elided from the emitted JS.
const require = createRequire(import.meta.url);
const AjvCtor = require('ajv/dist/2020.js') as typeof Ajv2020;
const addFormats = require('ajv-formats') as FormatsPlugin;

export interface Rejection {
  code:
    | 'envelope_invalid'
    | 'payload_invalid'
    | 'unknown_schema'
    | 'signature_missing'
    | 'signature_invalid'
    | 'sender_unknown'
    | 'duplicate_message'
    | 'acl_denied';
  detail: string;
}

export type ValidationResult = { ok: true } | { ok: false; rejection: Rejection };

const ajv = new AjvCtor({ strict: true, allErrors: true });
addFormats(ajv);

const compiled = new Map<SchemaRef, ValidateFunction>();

function validatorFor(ref: SchemaRef): ValidateFunction {
  let fn = compiled.get(ref);
  if (!fn) {
    fn = ajv.compile(getSchema(ref));
    compiled.set(ref, fn);
  }
  return fn;
}

function formatErrors(fn: ValidateFunction): string {
  return (fn.errors ?? [])
    .slice(0, 8)
    .map((e) => `${e.instancePath || '/'} ${e.message ?? ''}`.trim())
    .join('; ');
}

export function isKnownSchemaRef(ref: string): ref is SchemaRef {
  return (SCHEMA_REFS as readonly string[]).includes(ref);
}

/** Structural validation: envelope shape, schema ref existence, payload contract. */
export function validateMessage(message: unknown): ValidationResult {
  const envelopeFn = validatorFor('acs.envelope@1.0');
  if (!envelopeFn(message)) {
    return { ok: false, rejection: { code: 'envelope_invalid', detail: formatErrors(envelopeFn) } };
  }
  const msg = message as AcsMessage;
  const ref = msg.envelope.schema;
  if (!isKnownSchemaRef(ref) || (ref as string) === 'acs.envelope@1.0') {
    return { ok: false, rejection: { code: 'unknown_schema', detail: `schema "${ref}" is not in the contract registry` } };
  }
  const payloadFn = validatorFor(ref);
  if (!payloadFn(msg.payload)) {
    return { ok: false, rejection: { code: 'payload_invalid', detail: `${ref}: ${formatErrors(payloadFn)}` } };
  }
  return { ok: true };
}

/** Validate a standalone payload against a named contract (IP-1 structured generation). */
export function validatePayload(ref: SchemaRef, payload: unknown): ValidationResult {
  if (!isKnownSchemaRef(ref)) {
    return { ok: false, rejection: { code: 'unknown_schema', detail: String(ref) } };
  }
  const fn = validatorFor(ref);
  if (!fn(payload)) {
    return { ok: false, rejection: { code: 'payload_invalid', detail: `${ref}: ${formatErrors(fn)}` } };
  }
  return { ok: true };
}

export { ULID_PATTERN };
