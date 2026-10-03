/**
 * Envelope builder (R6) — a message is CREATED by filling the contract,
 * never by writing text (R1). Causation chains are explicit: replies carry
 * the message_id of their cause.
 */
import type { AcsMessage, Envelope, EnvelopeTrust, SchemaRef } from '@aisha/acs-contracts';
import { ulid } from './ulid.js';

export interface BuildEnvelopeInput<P extends object> {
  schema: Exclude<SchemaRef, 'acs.envelope@1.0'>;
  intentId: string;
  sender: string;
  recipient: string;
  payload: P;
  /** Reply-to: the message that caused this one. Opens a new correlation when absent. */
  causeMessage?: AcsMessage | null;
  trust?: Partial<EnvelopeTrust>;
  now?: () => Date;
}

export function buildMessage<P extends object>(input: BuildEnvelopeInput<P>): AcsMessage<P> {
  const now = input.now ?? (() => new Date());
  const cause = input.causeMessage ?? null;
  const envelope: Envelope = {
    message_id: ulid(),
    schema: input.schema,
    intent_id: cause ? cause.envelope.intent_id : input.intentId,
    correlation_id: cause ? cause.envelope.correlation_id : ulid(),
    causation_id: cause ? cause.envelope.message_id : null,
    sender: input.sender,
    recipient: input.recipient,
    sent_at: now().toISOString().replace(/\.\d{3}Z$/, 'Z'),
    signature: null,
    trust: {
      source_class: input.trust?.source_class ?? 'internal',
      derived: input.trust?.derived ?? false,
      source_ref: input.trust?.source_ref ?? null,
    },
  };
  if (cause && input.intentId && cause.envelope.intent_id !== input.intentId) {
    throw new Error(
      `acs-sdk: intent mismatch — cause message anchors ${cause.envelope.intent_id}, caller claims ${input.intentId}. ` +
        'A reply may not silently re-anchor to a different intent (R3).',
    );
  }
  return { envelope, payload: input.payload };
}
