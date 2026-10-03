import { describe, expect, it } from 'vitest';
import { generateKeyPairSync } from 'node:crypto';
import type { AcsMessage, TaskAssignPayload } from '@aisha/acs-contracts';
import { buildMessage } from './envelope.js';
import { canonicalJson } from './canonicalJson.js';
import { parseModeConfig, modeFor } from './modes.js';
import { receiveMessage, sendMessage } from './pipeline.js';
import { signMessage, verifySignature } from './signing.js';
import { ulid, intentId, ULID_PATTERN } from './ulid.js';
import { validateMessage } from './validate.js';

function keypair() {
  const { privateKey, publicKey } = generateKeyPairSync('ed25519');
  return { privateKey, publicKey };
}

function sampleMessage(): AcsMessage<TaskAssignPayload> {
  return buildMessage({
    schema: 'acs.task.assign@1.0',
    intentId: intentId(),
    sender: 'svc-ai-chat.planner',
    recipient: 'svc-agent-runner',
    payload: {
      task_kind: 'code_review',
      intent_ref: 'int_01JZX0000000000000000000AA',
      input_refs: [{ kind: 'document', id: 'doc-1' }],
      priority: 'p1',
    },
  });
}

describe('ulid', () => {
  it('matches the envelope pattern and is monotonic within one ms', () => {
    const t = Date.now();
    const a = ulid(t);
    const b = ulid(t);
    expect(a).toMatch(ULID_PATTERN);
    expect(b).toMatch(ULID_PATTERN);
    expect(b > a).toBe(true);
  });
});

describe('canonicalJson', () => {
  it('is key-order independent and rejects non-canonicalizable values', () => {
    expect(canonicalJson({ b: 1, a: [2, { d: 3, c: 4 }] })).toBe(canonicalJson({ a: [2, { c: 4, d: 3 }], b: 1 }));
    expect(() => canonicalJson({ x: Number.NaN })).toThrow();
    const cyclic: Record<string, unknown> = {};
    cyclic['self'] = cyclic;
    expect(() => canonicalJson(cyclic)).toThrow(/cyclic/);
  });
});

describe('envelope + signing', () => {
  it('builds a schema-valid message, signs and verifies it', () => {
    const msg = sampleMessage();
    expect(validateMessage(msg)).toEqual({ ok: true });

    const { privateKey, publicKey } = keypair();
    msg.envelope.signature = signMessage(msg, privateKey);
    expect(verifySignature(msg, publicKey)).toBe(true);
  });

  it('detects payload tampering after signing', () => {
    const msg = sampleMessage();
    const { privateKey, publicKey } = keypair();
    msg.envelope.signature = signMessage(msg, privateKey);
    msg.payload.priority = 'p0';
    expect(verifySignature(msg, publicKey)).toBe(false);
  });

  it('reply inherits intent + correlation and refuses silent re-anchoring (R3)', () => {
    const first = sampleMessage();
    const reply = buildMessage({
      schema: 'acs.task.result@1.0',
      intentId: first.envelope.intent_id,
      sender: 'svc-agent-runner',
      recipient: 'svc-ai-chat.planner',
      causeMessage: first,
      payload: {
        status: 'completed',
        intent_ref: first.envelope.intent_id,
        output_ref: { kind: 'run', id: 'run-1' },
        metrics: { duration_ms: 5 },
      },
    });
    expect(reply.envelope.correlation_id).toBe(first.envelope.correlation_id);
    expect(reply.envelope.causation_id).toBe(first.envelope.message_id);
    expect(reply.envelope.intent_id).toBe(first.envelope.intent_id);

    expect(() =>
      buildMessage({
        schema: 'acs.task.result@1.0',
        intentId: intentId(),
        sender: 'svc-agent-runner',
        recipient: 'svc-ai-chat.planner',
        causeMessage: first,
        payload: {} as never,
      }),
    ).toThrow(/re-anchor/);
  });
});

describe('modes', () => {
  it('fails closed on config typos and honours per-type overrides', () => {
    const warnings: string[] = [];
    const cfg = parseModeConfig(
      { ACS_MODE: 'enfroce', ACS_MODE_OVERRIDES: '{"acs.task.assign@1.0":"enforce","x@1.0":"loud"}' },
      (d) => warnings.push(d),
    );
    expect(cfg.globalMode).toBe('off');
    expect(modeFor(cfg, 'acs.task.assign@1.0')).toBe('enforce');
    expect(modeFor(cfg, 'acs.task.result@1.0')).toBe('off');
    expect(warnings.length).toBe(2);
  });
});

describe('pipelines', () => {
  it('off mode is a pure pass-through (No Regressions)', async () => {
    const sent: AcsMessage[] = [];
    const msg = sampleMessage();
    await sendMessage(
      msg,
      { modeConfig: { globalMode: 'off', overrides: {} } },
      { transport: async (m) => void sent.push(m) },
    );
    expect(sent).toHaveLength(1);
    expect(sent[0].envelope.signature).toBeNull();
  });

  it('enforce send: unsigned or invalid messages do not leave the process', async () => {
    const msg = sampleMessage();
    await expect(
      sendMessage(msg, { modeConfig: { globalMode: 'enforce', overrides: {} } }, { transport: async () => {} }),
    ).rejects.toThrow(/signature/);

    const { privateKey } = keypair();
    const broken = sampleMessage();
    (broken.payload as Record<string, unknown>)['priority'] = 'urgent-ish';
    await expect(
      sendMessage(
        broken,
        { modeConfig: { globalMode: 'enforce', overrides: {} }, privateKey },
        { transport: async () => {} },
      ),
    ).rejects.toThrow(/rejected/);
  });

  it('receive: dedup drops replays even below enforce; enforce dead-letters invalid traffic', async () => {
    const seen = new Set<string>();
    const dispatched: string[] = [];
    const deadLettered: unknown[] = [];
    const { privateKey, publicKey } = keypair();
    const msg = sampleMessage();
    msg.envelope.signature = signMessage(msg, privateKey);

    const hooks = {
      isDuplicate: async (id: string) => seen.has(id),
      deadLetter: async (raw: unknown) => void deadLettered.push(raw),
      dispatch: async (m: AcsMessage) => {
        seen.add(m.envelope.message_id);
        dispatched.push(m.envelope.message_id);
      },
    };
    const ctx = {
      modeConfig: { globalMode: 'enforce' as const, overrides: {} },
      trustStore: { publicKeyFor: () => publicKey },
      selfIdentity: 'svc-agent-runner',
    };

    expect(await receiveMessage(msg, ctx, hooks)).toBe('dispatched');
    expect(await receiveMessage(msg, ctx, hooks)).toBe('dropped'); // replay
    expect(dispatched).toHaveLength(1);

    expect(await receiveMessage({ hello: 'world' }, ctx, hooks)).toBe('dropped');
    expect(deadLettered.length).toBeGreaterThanOrEqual(1);
  });

  it('shadow mode never blocks legacy traffic', async () => {
    const ctx = { modeConfig: { globalMode: 'shadow' as const, overrides: {} } };
    const outcome = await receiveMessage({ legacy: true }, ctx, { dispatch: async () => {} });
    expect(outcome).toBe('passed_unvalidated');
  });
});
