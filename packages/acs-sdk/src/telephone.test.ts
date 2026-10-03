/**
 * Telephone-game regression (ACS §7 test strategy): a 5-hop agent chain must
 * deliver the ORIGINAL meaning byte-identically, because meaning travels by
 * reference to the immutable intent — never as a paraphrase. Also exercises
 * the readback machine end-to-end.
 */
import { describe, expect, it } from 'vitest';
import { generateKeyPairSync } from 'node:crypto';
import type { AcsMessage, TaskAssignPayload } from '@aisha/acs-contracts';
import { buildMessage } from './envelope.js';
import { buildProposal, decideProposal, executeGuarded } from './readback.js';
import { receiveMessage, sendMessage } from './pipeline.js';
import { signMessage } from './signing.js';
import { intentId } from './ulid.js';

describe('telephone game — 5 hops, zero drift', () => {
  it('the intent reference and canonical text survive 5 agent hops untouched', async () => {
    const { privateKey, publicKey } = generateKeyPairSync('ed25519');
    const intentStore = new Map<string, string>();
    const intent = intentId();
    const CANONICAL = 'Přelož dokument doc-42 do angličtiny, zachovej formátování, rozpočet 3 jednotky.';
    intentStore.set(intent, CANONICAL);

    const agents = ['svc-ai-chat.planner', 'agent.knowledge', 'agent.compliance', 'agent.delivery', 'svc-agent-runner'];
    const wire: AcsMessage[] = [];
    const seen = new Set<string>();

    let previous: AcsMessage | null = null;
    for (let hop = 0; hop < agents.length - 1; hop++) {
      const msg: AcsMessage<TaskAssignPayload> = buildMessage({
        schema: 'acs.task.assign@1.0',
        intentId: intent,
        sender: agents[hop],
        recipient: agents[hop + 1],
        causeMessage: previous,
        payload: {
          task_kind: 'translate_document',
          intent_ref: intent,
          input_refs: [{ kind: 'document', id: 'doc-42' }],
          priority: 'p2',
          constraints: { budget_units: 3 },
        },
      });
      await sendMessage(
        msg,
        { modeConfig: { globalMode: 'enforce', overrides: {} }, privateKey },
        { transport: async (m) => void wire.push(m) },
      );
      const outcome = await receiveMessage(
        wire[wire.length - 1],
        {
          modeConfig: { globalMode: 'enforce', overrides: {} },
          trustStore: { publicKeyFor: () => publicKey },
          selfIdentity: agents[hop + 1],
        },
        {
          isDuplicate: async (id) => seen.has(id),
          dispatch: async (m) => void seen.add(m.envelope.message_id),
        },
      );
      expect(outcome).toBe('dispatched');
      previous = msg;
    }

    // After 5 hops: every message anchors the SAME intent and correlation;
    // the canonical text was never copied into any payload — it is read once,
    // at the point of use, from the immutable store.
    const intents = new Set(wire.map((m) => m.envelope.intent_id));
    const correlations = new Set(wire.map((m) => m.envelope.correlation_id));
    expect(intents.size).toBe(1);
    expect(correlations.size).toBe(1);
    expect(intentStore.get([...intents][0])).toBe(CANONICAL);

    // Causation chain is complete and ordered.
    for (let i = 1; i < wire.length; i++) {
      expect(wire[i].envelope.causation_id).toBe(wire[i - 1].envelope.message_id);
    }
  });
});

describe('readback end-to-end', () => {
  it('confirm → execute happy path; params drift and unclassified class are stopped', async () => {
    const intentRef = intentId();
    const params = { path: '/tmp/out.txt', content: 'hello' };
    const proposal = buildProposal({
      toolName: 'file_write',
      effectClass: 'write',
      intentRef,
      target: '/tmp/out.txt',
      action: 'write',
      params,
    });
    const decision = decideProposal(proposal, { allowed_tools: ['file_write'], budget_units: 10 });
    expect(decision.decision).toBe('confirm');

    let executed = 0;
    await executeGuarded(proposal, decision, params, async () => void (executed += 1));
    expect(executed).toBe(1);

    // Drifted params must not execute (R5).
    await expect(
      executeGuarded(proposal, decision, { ...params, content: 'goodbye' }, async () => void (executed += 1)),
    ).rejects.toThrow(/drifted/);
    expect(executed).toBe(1);

    // Unclassified tools are deny-fast.
    const unknownTool = buildProposal({
      toolName: 'mystery_tool',
      effectClass: 'unclassified',
      intentRef,
      target: 'somewhere',
      action: 'do',
      params: {},
    });
    expect(decideProposal(unknownTool, null).decision).toBe('abort');

    // Tool outside the intent allowlist is denied by ACL.
    const denied = decideProposal(proposal, { allowed_tools: ['other_tool'] });
    expect(denied.decision).toBe('abort');
    expect(denied.decided_by).toBe('acl');
  });
});
