/**
 * Send / receive pipelines (IP-2 / IP-4).
 *
 * Transport, persistence and dedup are injected (DI) so the SDK stays pure and
 * unit-testable; services plug in postgrest/pg/redis implementations. The
 * pipeline enforces the mode ladder:
 *
 *   send:    build → validate → sign → persist(log) → transport
 *   receive: parse → dedup → verify signature → validate → dispatch
 *
 * In shadow/warn, failures are reported to hooks but traffic flows unchanged.
 * In enforce, failures stop the message (send throws, receive dead-letters).
 */
import type { AcsMessage } from '@aisha/acs-contracts';
import type { KeyObject } from 'node:crypto';
import { signMessage, verifySignature, type TrustStore } from './signing.js';
import { validateMessage, type Rejection } from './validate.js';
import { modeAtLeast, modeFor, type ModeConfig } from './modes.js';

export interface SendHooks {
  /** Append-only log (acs_message_log). Called in shadow and above. */
  persist?: (message: AcsMessage) => Promise<void>;
  /** Actual delivery (NOTIFY/webhook/HTTP). Always called unless enforce-rejected. */
  transport: (message: AcsMessage) => Promise<void>;
  onViolation?: (rejection: Rejection, message: AcsMessage) => void;
}

export interface SendContext {
  modeConfig: ModeConfig;
  privateKey?: KeyObject | null;
}

export async function sendMessage(message: AcsMessage, ctx: SendContext, hooks: SendHooks): Promise<void> {
  const mode = modeFor(ctx.modeConfig, message.envelope.schema);
  if (mode === 'off') {
    await hooks.transport(message);
    return;
  }

  if (ctx.privateKey) {
    message.envelope.signature = signMessage(message, ctx.privateKey);
  }

  const result = validateMessage(message);
  if (!result.ok) {
    hooks.onViolation?.(result.rejection, message);
    if (modeAtLeast(mode, 'enforce')) {
      throw new Error(`ACS enforce: outbound message rejected — ${result.rejection.code}: ${result.rejection.detail}`);
    }
  }
  if (modeAtLeast(mode, 'enforce') && !message.envelope.signature) {
    const rejection: Rejection = { code: 'signature_missing', detail: 'enforce mode requires an envelope signature' };
    hooks.onViolation?.(rejection, message);
    throw new Error(`ACS enforce: ${rejection.detail}`);
  }

  await hooks.persist?.(message);
  await hooks.transport(message);
}

export interface ReceiveHooks {
  /** Returns true when message_id was already processed (replay/dedup, R6). */
  isDuplicate?: (messageId: string) => Promise<boolean>;
  /** Sender × schema × recipient allow-check (acs_agent_acl, default deny in enforce). */
  aclAllows?: (sender: string, schemaRef: string, recipient: string) => Promise<boolean>;
  deadLetter?: (raw: unknown, rejection: Rejection) => Promise<void>;
  onViolation?: (rejection: Rejection, raw: unknown) => void;
  /** Typed dispatch — called only when the message passed every gate of the active mode. */
  dispatch: (message: AcsMessage) => Promise<void>;
}

export interface ReceiveContext {
  modeConfig: ModeConfig;
  trustStore?: TrustStore | null;
  selfIdentity?: string;
}

async function reject(mode: string, raw: unknown, rejection: Rejection, hooks: ReceiveHooks): Promise<'dropped' | 'passed'> {
  hooks.onViolation?.(rejection, raw);
  if (mode === 'enforce') {
    await hooks.deadLetter?.(raw, rejection);
    return 'dropped';
  }
  return 'passed';
}

/**
 * Inbound gate. Returns 'dispatched' | 'dropped' | 'passed_unvalidated'
 * ('passed_unvalidated' happens only below enforce, keeping legacy flow alive).
 */
export async function receiveMessage(
  raw: unknown,
  ctx: ReceiveContext,
  hooks: ReceiveHooks,
): Promise<'dispatched' | 'dropped' | 'passed_unvalidated'> {
  const looksLikeAcs =
    typeof raw === 'object' && raw !== null && 'envelope' in (raw as Record<string, unknown>);
  const schemaRef = looksLikeAcs
    ? String(((raw as AcsMessage).envelope ?? {}).schema ?? '')
    : '';
  const mode = modeFor(ctx.modeConfig, schemaRef || '*');

  if (mode === 'off') return 'passed_unvalidated';

  if (!looksLikeAcs) {
    const verdict = await reject(mode, raw, { code: 'envelope_invalid', detail: 'no envelope present' }, hooks);
    return verdict === 'dropped' ? 'dropped' : 'passed_unvalidated';
  }

  const message = raw as AcsMessage;

  const structural = validateMessage(message);
  if (!structural.ok) {
    const verdict = await reject(mode, raw, structural.rejection, hooks);
    return verdict === 'dropped' ? 'dropped' : 'passed_unvalidated';
  }

  if (hooks.isDuplicate && (await hooks.isDuplicate(message.envelope.message_id))) {
    const verdict = await reject(mode, raw, { code: 'duplicate_message', detail: message.envelope.message_id }, hooks);
    if (verdict === 'dropped') return 'dropped';
    // Even below enforce a duplicate is never re-dispatched — idempotence is not optional.
    return 'dropped';
  }

  if (ctx.trustStore) {
    const key = ctx.trustStore.publicKeyFor(message.envelope.sender);
    if (!key) {
      const verdict = await reject(mode, raw, { code: 'sender_unknown', detail: message.envelope.sender }, hooks);
      if (verdict === 'dropped') return 'dropped';
    } else if (!verifySignature(message, key)) {
      const rejection: Rejection = {
        code: message.envelope.signature ? 'signature_invalid' : 'signature_missing',
        detail: message.envelope.sender,
      };
      const verdict = await reject(mode, raw, rejection, hooks);
      if (verdict === 'dropped') return 'dropped';
    }
  }

  if (hooks.aclAllows && ctx.selfIdentity) {
    const allowed = await hooks.aclAllows(message.envelope.sender, message.envelope.schema, ctx.selfIdentity);
    if (!allowed) {
      const verdict = await reject(mode, raw, { code: 'acl_denied', detail: `${message.envelope.sender} → ${ctx.selfIdentity}` }, hooks);
      if (verdict === 'dropped') return 'dropped';
    }
  }

  await hooks.dispatch(message);
  return 'dispatched';
}
