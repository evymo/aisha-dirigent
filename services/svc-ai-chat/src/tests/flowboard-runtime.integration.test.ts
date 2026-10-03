/**
 * Flowboard runtime — A-to-Z integration test (REAL DB + PostgREST + the real executor).
 *
 * Proves the full human-in-the-loop loop works through the ACTUAL executor against a real
 * cold-start schema: a flow halts at a consent gate, the gate is approved via the real
 * respond_to_story_block_audited('approve_flow_gate'), the run resumes and completes, the action
 * node enqueues a real notification via aisha_notify_via_openclaw, and the StoryLoop provenance
 * (flow_run / automation_step / consent_request / outbox row) lands correctly.
 *
 * Nothing in the DB path is mocked — create_story_entry_audited, respond_to_story_block_audited,
 * get_story_entries_audited, aisha_notify_via_openclaw all run for real under a USER JWT. ONLY the
 * LLM (agent dispatch) is stubbed — we never hit a paid provider.
 *
 * Run: npm run test:flowboard:fullenv (skips offline — no POSTGREST_URL / AISHA_DB_URL).
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { createHmac, randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import {
  executeFlowGraph,
  type ExecutorPgrest,
  type FlowGraph,
  type FlowRunContext,
  type ActionDispatch,
  type AgentDispatch,
} from '../lib/flowboardSandboxExecutor.js';
import { buildResumeState } from '../routes/flowboard-run.js';

const BASE = process.env.POSTGREST_URL;
const SECRET = process.env.POSTGREST_JWT_SECRET;
const DB_URL = process.env.AISHA_DB_URL;
const RUN = BASE && SECRET && DB_URL ? describe : describe.skip;
// The agent-real-LLM case additionally needs FLOWBOARD_REAL_LLM=1 + OPENAI_API_KEY (never a paid
// call in CI / the stubbed path).
const REAL_LLM = process.env.FLOWBOARD_REAL_LLM === '1' && !!process.env.OPENAI_API_KEY;

function b64u(s: string): string {
  return Buffer.from(s).toString('base64url');
}
function mintUserJwt(sub: string): string {
  const header = b64u(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const now = Math.floor(Date.now() / 1000);
  const payload = b64u(JSON.stringify({ role: 'authenticated', sub, iss: 'aisha', iat: now, exp: now + 3600 }));
  const sig = createHmac('sha256', SECRET as string).update(`${header}.${payload}`).digest('base64url');
  return `${header}.${payload}.${sig}`;
}

interface EntryRow {
  id: string;
  entry_type: string;
  metadata: { flowboard?: { kind?: string; nodeId?: string; status?: string; graphId?: string; output?: string } };
}

// A real PostgREST adapter for a given JWT — the executor's DB seam, unmocked.
function pgrestFor(jwt: string): ExecutorPgrest {
  return {
    async rpc(fn, params) {
      const res = await fetch(`${BASE}/rpc/${fn}`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${jwt}`, 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify(params),
      });
      if (!res.ok) return { data: null, error: { message: `${res.status}: ${await res.text()}` } };
      const text = await res.text();
      return { data: text ? JSON.parse(text) : null, error: null };
    },
  };
}

function psql(sql: string): string {
  return execFileSync('psql', [DB_URL as string, '-v', 'ON_ERROR_STOP=1', '-tAc', sql], { encoding: 'utf-8' });
}

RUN('Flowboard runtime A-to-Z (real DB + PostgREST + real executor)', () => {
  const userId = randomUUID();
  const partnerId = randomUUID();
  const storyId = randomUUID();
  let userPg: ExecutorPgrest;
  let actionDispatch: ActionDispatch;

  const graph: FlowGraph = {
    id: randomUUID(),
    name: 'Help inbox',
    nodes: [
      { id: 't', typeId: 'trigger.email_inbound' },
      { id: 'a', typeId: 'agent.knowledge' },
      { id: 'gate', typeId: 'gate.consent', config: { reason: 'Approve the reply before sending' } },
      { id: 'k', typeId: 'action.email_send', config: { recipient: 'user@example.com', subject: 'Re: help', body: 'Resolved.' } },
    ],
    edges: [
      { id: 'e1', source: 't', target: 'a' },
      { id: 'e2', source: 'a', target: 'gate' },
      { id: 'e3', source: 'gate', target: 'k' },
    ],
  };

  const entryRows = async (): Promise<EntryRow[]> => {
    const { data, error } = await userPg.rpc('get_story_entries_audited', { p_limit: 500, p_offset: 0, p_story_id: storyId });
    if (error) throw new Error(`get_story_entries_audited failed: ${JSON.stringify(error)}`);
    return (Array.isArray(data) ? data : []) as EntryRow[];
  };

  beforeAll(() => {
    // Fixture (FK/triggers off — synthetic ids): a user, a partner, and a story the user owns.
    psql(
      `SET session_replication_role = replica;
       INSERT INTO aisha_auth.users (id) VALUES ('${userId}') ON CONFLICT DO NOTHING;
       INSERT INTO partner_profiles (id, user_id, display_name, city)
         VALUES ('${partnerId}', '${userId}', 'A-Z Partner', 'Test') ON CONFLICT DO NOTHING;
       INSERT INTO partner_stories (id, partner_id, user_id, title)
         VALUES ('${storyId}', '${partnerId}', '${userId}', 'Flowboard A-Z') ON CONFLICT DO NOTHING;`,
    );
    userPg = pgrestFor(mintUserJwt(userId));
    actionDispatch = async ({ channel, recipient, payload, storyId: sid }) => {
      const { data, error } = await userPg.rpc('aisha_notify_via_openclaw', {
        p_channel: channel,
        p_payload: payload,
        p_recipient: recipient,
        p_story_id: sid,
      });
      if (error) throw new Error(JSON.stringify(error));
      const r = data as { notification_id?: string; id?: string } | null;
      return { notificationId: r?.notification_id ?? r?.id };
    };
  });

  it('runs draw → halt → approve → resume → action → provenance against the real DB', async () => {
    const dispatch = async () => ({ text: 'Drafted: your issue is resolved.' });
    const ctxBase: Omit<FlowRunContext, 'resume'> = { storyId, graphId: graph.id, runId: randomUUID(), userId, engine: 'sandbox' };

    // 1. First run → halts at the consent gate (real provenance written).
    const r1 = await executeFlowGraph(graph, ctxBase, { pgrestUser: userPg, dispatch, actionDispatch });
    expect(r1.status).toBe('awaiting_approval');
    expect(r1.haltedAtNodeId).toBe('gate');

    const e1 = await entryRows();
    const consent = e1.find((e) => e.entry_type === 'consent_request');
    expect(consent).toBeTruthy();
    expect(consent!.metadata.flowboard?.status).toBe('awaiting_approval');
    expect(consent!.metadata.flowboard?.graphId).toBe(graph.id);
    // the action did NOT run (it is downstream of the un-approved gate)
    expect(e1.some((e) => e.entry_type === 'automation_step' && e.metadata.flowboard?.nodeId === 'k')).toBe(false);

    // 2. Approve the gate via the real RPC.
    const approve = await userPg.rpc('respond_to_story_block_audited', {
      p_action: 'approve_flow_gate',
      p_action_data: {},
      p_entry_id: consent!.id,
      p_story_id: storyId,
    });
    expect(approve.error).toBeNull();

    // 3. Reconstruct resume state from real provenance + resume.
    const resume = buildResumeState(await entryRows());
    expect(resume).toBeTruthy();
    const r2 = await executeFlowGraph(graph, { ...ctxBase, runId: randomUUID(), resume }, { pgrestUser: userPg, dispatch, actionDispatch });
    expect(r2.status).toBe('complete');

    // 4. Verify the full provenance in the real DB.
    const e3 = await entryRows();
    expect(e3.filter((e) => e.entry_type === 'flow_run').length).toBe(1); // idempotent — emitted once
    const gateStep = e3.find((e) => e.entry_type === 'automation_step' && e.metadata.flowboard?.nodeId === 'gate');
    expect(gateStep?.metadata.flowboard?.status).toBe('approved');
    const actionStep = e3.find((e) => e.entry_type === 'automation_step' && e.metadata.flowboard?.nodeId === 'k');
    expect(actionStep?.metadata.flowboard?.status).toBe('executed');

    // 5. The action enqueued a real notification into the outbox.
    const outbox = Number(psql(`SELECT count(*) FROM openclaw_notifications WHERE story_id = '${storyId}'`).trim());
    expect(outbox).toBeGreaterThanOrEqual(1);
  });

  (REAL_LLM ? it : it.skip)('agent produces REAL OpenAI output and the email action enqueues (real LLM)', async () => {
    const sid = randomUUID();
    psql(
      `SET session_replication_role = replica;
       INSERT INTO partner_stories (id, partner_id, user_id, title)
         VALUES ('${sid}', '${partnerId}', '${userId}', 'Real LLM') ON CONFLICT DO NOTHING;`,
    );
    const realDispatch: AgentDispatch = async ({ prompt }) => {
      const { unifiedChat, resolveAvailableModel } = await import('../lib/llmRouter.js');
      const m = resolveAvailableModel('gpt-4o-mini');
      const r = await unifiedChat({
        provider: m.provider,
        model: m.model,
        maxTokens: 60,
        systemPrompt: 'Reply with one short factual sentence.',
        messages: [{ role: 'user', content: prompt }],
        temperature: 0,
      });
      return { text: r.text };
    };
    const g: FlowGraph = {
      id: randomUUID(),
      name: 'Real LLM flow',
      nodes: [
        { id: 'a', typeId: 'agent.knowledge' },
        { id: 'k', typeId: 'action.email_send', config: { recipient: 'admin@test.local', subject: 'Auto', body: 'See the run.' } },
      ],
      edges: [{ id: 'e', source: 'a', target: 'k' }],
    };
    const result = await executeFlowGraph(
      g,
      { storyId: sid, graphId: g.id, runId: randomUUID(), userId, engine: 'sandbox' },
      { pgrestUser: userPg, dispatch: realDispatch, actionDispatch },
    );
    expect(result.status).toBe('complete');

    // The agent produced REAL model output (non-empty), recorded into provenance.
    const { data } = await userPg.rpc('get_story_entries_audited', { p_limit: 100, p_offset: 0, p_story_id: sid });
    const rows = (Array.isArray(data) ? data : []) as EntryRow[];
    const agentStep = rows.find((e) => e.entry_type === 'automation_step' && e.metadata.flowboard?.nodeId === 'a');
    expect((agentStep?.metadata.flowboard?.output ?? '').length).toBeGreaterThan(5);

    // The email action enqueued.
    expect(Number(psql(`SELECT count(*) FROM openclaw_notifications WHERE story_id = '${sid}'`).trim())).toBeGreaterThanOrEqual(1);
  });
});
