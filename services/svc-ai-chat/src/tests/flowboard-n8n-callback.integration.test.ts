/**
 * Flowboard n8n per-node provenance callback — integration test against a REAL DB.
 *
 * TEST-FIRST for the per-node layer: the n8n execution callback (/flowboard-n8n-callback)
 * maps each executed node → an automation_step story_entry via the service-role writer
 * append_flowboard_run_entry_service. Nothing on the DB path is mocked; the provenance is
 * read back from the real DB. Idempotency (a retried callback never double-writes) is asserted.
 *
 * Runs inside the throwaway-DB harness (DB auto-provisioned). Auth uses X-N8N-API-Key, so the
 * test supplies N8N_API_KEY (matching the service config). Skipped without the DB env + key.
 *   npm run test:flowboard:n8n     # (also runs flowboard-n8n.integration against a live n8n)
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import Fastify, { type FastifyInstance } from 'fastify';
import { flowboardN8nCallbackRoutes } from '../routes/flowboard-n8n-callback.js';

const BASE = process.env.POSTGREST_URL;
const DB_URL = process.env.AISHA_DB_URL;
const N8N_KEY = process.env.N8N_API_KEY;
const RUN = BASE && DB_URL && N8N_KEY ? describe : describe.skip;

const psql = (sql: string): string =>
  execFileSync('psql', [DB_URL as string, '-v', 'ON_ERROR_STOP=1', '-tAc', sql], { encoding: 'utf-8' });

RUN('Flowboard n8n per-node provenance callback (real DB)', () => {
  const userId = randomUUID();
  const partnerId = randomUUID();
  const storyId = randomUUID();
  const runId = randomUUID();
  let app: FastifyInstance;

  beforeAll(async () => {
    psql(
      `SET session_replication_role = replica;
       INSERT INTO aisha_auth.users (id) VALUES ('${userId}') ON CONFLICT DO NOTHING;
       INSERT INTO partner_profiles (id, user_id, display_name, city)
         VALUES ('${partnerId}', '${userId}', 'n8n cb', 'Test') ON CONFLICT DO NOTHING;
       INSERT INTO partner_stories (id, partner_id, user_id, title)
         VALUES ('${storyId}', '${partnerId}', '${userId}', 'Flowboard n8n cb') ON CONFLICT DO NOTHING;`,
    );
    app = Fastify();
    await app.register(flowboardN8nCallbackRoutes);
    await app.ready();
  });

  const post = (steps: unknown[]) =>
    app.inject({
      method: 'POST',
      url: '/flowboard-n8n-callback',
      headers: { 'x-n8n-api-key': N8N_KEY as string },
      payload: { story_id: storyId, owner_id: userId, graph_id: randomUUID(), run_id: runId, steps },
    });

  const stepRows = (): number =>
    Number(psql(
      `SELECT count(*) FROM story_entries WHERE story_id='${storyId}' AND entry_type='automation_step'
         AND metadata->'flowboard'->>'runId'='${runId}'`,
    ).trim());

  it('rejects a bad n8n API key', async () => {
    const res = await app.inject({
      method: 'POST', url: '/flowboard-n8n-callback',
      headers: { 'x-n8n-api-key': 'wrong' },
      payload: { story_id: storyId, owner_id: userId, graph_id: 'g', run_id: runId, steps: [] },
    });
    expect(res.statusCode).toBe(401);
  });

  it('writes one automation_step per node into the real StoryLoop story', async () => {
    const res = await post([
      { node_id: 't', type_id: 'trigger.email_inbound', status: 'success' },
      { node_id: 'a', type_id: 'agent.knowledge', status: 'success', output: 'drafted' },
    ]);
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ ok: true, written: 2 });
    expect(stepRows()).toBe(2);

    // owner-attributed + lucide icon, never internal
    const meta = psql(
      `SELECT metadata->'flowboard'->>'icon' FROM story_entries
         WHERE story_id='${storyId}' AND metadata->'flowboard'->>'nodeId'='a'`,
    ).trim();
    expect(/^[a-z-]+$/.test(meta)).toBe(true);
    const createdBy = psql(
      `SELECT created_by FROM story_entries WHERE story_id='${storyId}' AND metadata->'flowboard'->>'nodeId'='a'`,
    ).trim();
    expect(createdBy).toBe(userId);
  });

  it('is idempotent — a retried callback does NOT double-write', async () => {
    const before = stepRows();
    const res = await post([{ node_id: 't', type_id: 'trigger.email_inbound', status: 'success' }]);
    expect(res.statusCode).toBe(200);
    expect(stepRows()).toBe(before); // deduped by (run_id, node_id)
  });
});
