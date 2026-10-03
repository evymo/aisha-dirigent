/**
 * Flowboard n8n engine — integration test against a REAL n8n + DB (dev environment).
 *
 * The point of this test is that a 200 from the n8n path means the workflow was REALLY
 * created + activated on the live n8n instance and the flow_run provenance REALLY landed in
 * StoryLoop — not a mocked HTTP echo. It mirrors flowboard-runtime.integration.test.ts:
 * env-gated, nothing on the n8n/DB path mocked.
 *
 * Run locally — the DB (PostgREST + cold-start schema) is auto-provisioned by the throwaway
 * harness; only a live n8n must be brought up first:
 *   docker compose -f docker-compose.coolify-n8n.yml up -d n8n   # local n8n on :5678
 *   # create an API key in n8n (Settings → API), then:
 *   N8N_BASE_URL=http://localhost:5678 N8N_API_KEY=<key> npm run test:flowboard:n8n
 * Skipped when N8N_BASE_URL / N8N_API_KEY (or the DB env) are unset.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createHmac, randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import {
  compileToN8n,
  buildFlowRegistry,
  builtinProvider,
  agentCatalogProvider,
  buildFlowRunEntry,
  type FlowGraph as CoreFlowGraph,
  type AgentCatalogRow,
} from '@aisha/flowboard-core';

const N8N = process.env.N8N_BASE_URL;
const N8N_KEY = process.env.N8N_API_KEY;
const BASE = process.env.POSTGREST_URL;
const SECRET = process.env.POSTGREST_JWT_SECRET;
const DB_URL = process.env.AISHA_DB_URL;
const RUN = N8N && N8N_KEY && BASE && SECRET && DB_URL ? describe : describe.skip;

const b64u = (s: string): string => Buffer.from(s).toString('base64url');
function mintUserJwt(sub: string): string {
  const header = b64u(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const now = Math.floor(Date.now() / 1000);
  const payload = b64u(JSON.stringify({ role: 'authenticated', sub, iss: 'aisha', iat: now, exp: now + 3600 }));
  const sig = createHmac('sha256', SECRET as string).update(`${header}.${payload}`).digest('base64url');
  return `${header}.${payload}.${sig}`;
}
async function rpc(jwt: string, fn: string, params: Record<string, unknown>): Promise<{ data: unknown; error: unknown }> {
  const res = await fetch(`${BASE}/rpc/${fn}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${jwt}`, 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify(params),
  });
  if (!res.ok) return { data: null, error: { message: `${res.status}: ${await res.text()}` } };
  const t = await res.text();
  return { data: t ? JSON.parse(t) : null, error: null };
}
const psql = (sql: string): string =>
  execFileSync('psql', [DB_URL as string, '-v', 'ON_ERROR_STOP=1', '-tAc', sql], { encoding: 'utf-8' });
const n8nBase = (): string => (N8N as string).replace(/\/$/, '');
const n8nHeaders = (): Record<string, string> => ({ 'content-type': 'application/json', 'X-N8N-API-Key': N8N_KEY as string });

const helpGraph: CoreFlowGraph = {
  id: randomUUID(),
  version: 1,
  name: `it-n8n-${Date.now()}`,
  nodes: [
    { id: 't', typeId: 'trigger.webhook', position: { x: 0, y: 0 }, config: {}, draft: false },
    { id: 'a', typeId: 'agent.knowledge', position: { x: 240, y: 0 }, config: {}, draft: false },
    { id: 'k', typeId: 'action.notify', position: { x: 480, y: 0 }, config: {}, draft: false },
  ],
  edges: [
    { id: 'e1', source: 't', sourcePort: 'out', target: 'a', targetPort: 'in' },
    { id: 'e2', source: 'a', sourcePort: 'out', target: 'k', targetPort: 'in' },
  ],
  meta: {},
};

RUN('Flowboard n8n engine (real n8n + DB)', () => {
  const userId = randomUUID();
  const partnerId = randomUUID();
  const storyId = randomUUID();
  let jwt: string;
  let createdWorkflowId: string | undefined;

  beforeAll(() => {
    psql(
      `SET session_replication_role = replica;
       INSERT INTO aisha_auth.users (id) VALUES ('${userId}') ON CONFLICT DO NOTHING;
       INSERT INTO partner_profiles (id, user_id, display_name, city)
         VALUES ('${partnerId}', '${userId}', 'n8n IT', 'Test') ON CONFLICT DO NOTHING;
       INSERT INTO partner_stories (id, partner_id, user_id, title)
         VALUES ('${storyId}', '${partnerId}', '${userId}', 'Flowboard n8n IT') ON CONFLICT DO NOTHING;`,
    );
    jwt = mintUserJwt(userId);
  });

  afterAll(async () => {
    if (createdWorkflowId) {
      await fetch(`${n8nBase()}/api/v1/workflows/${createdWorkflowId}`, { method: 'DELETE', headers: n8nHeaders() }).catch(() => {});
    }
  });

  it('compiles → CREATES + ACTIVATES a real n8n workflow and lands flow_run provenance', async () => {
    // 1. Federated registry from the real active agent_catalog (server-authoritative).
    const { data: agentRows } = await rpc(jwt, 'get_flowboard_agent_catalog', {});
    const registry = await buildFlowRegistry([
      builtinProvider(),
      agentCatalogProvider(async () => (Array.isArray(agentRows) ? (agentRows as AgentCatalogRow[]) : [])),
    ]);

    // 2. Compile → push (CREATE) on the real n8n instance.
    const workflow = compileToN8n(helpGraph, registry);
    const createRes = await fetch(`${n8nBase()}/api/v1/workflows`, {
      method: 'POST', headers: n8nHeaders(), body: JSON.stringify(workflow),
    });
    expect(createRes.ok).toBe(true); // REAL create, not a mock
    const created = (await createRes.json()) as { id?: string };
    expect(created.id).toBeTruthy();
    createdWorkflowId = created.id;

    // 3. ACTIVATE → the workflow is really live on its trigger.
    const actRes = await fetch(`${n8nBase()}/api/v1/workflows/${created.id}/activate`, { method: 'POST', headers: n8nHeaders() });
    expect(actRes.ok).toBe(true);
    // n8n reports the workflow as active.
    const getRes = await fetch(`${n8nBase()}/api/v1/workflows/${created.id}`, { headers: n8nHeaders() });
    const fetched = (await getRes.json()) as { active?: boolean };
    expect(fetched.active).toBe(true);

    // 4. Provenance umbrella under the user's JWT — REALLY in StoryLoop.
    const runId = randomUUID();
    const fbRun = buildFlowRunEntry({ storyId, runId, graphId: helpGraph.id, graphName: helpGraph.name, engine: 'n8n' });
    const { error } = await rpc(jwt, 'create_story_entry_audited', fbRun as unknown as Record<string, unknown>);
    expect(error).toBeNull();

    const rows = Number(psql(
      `SELECT count(*) FROM story_entries WHERE story_id='${storyId}' AND entry_type='flow_run'
         AND metadata->'flowboard'->>'engine'='n8n'`,
    ).trim());
    expect(rows).toBeGreaterThanOrEqual(1); // the 200 is backed by real provenance
  });
});
