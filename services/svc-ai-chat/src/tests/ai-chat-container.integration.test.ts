/**
 * Real-conditions integration — hits the RUNNING svc-ai-chat container on its
 * host-exposed port (warmup `--preset optimum-ai` + LOCAL_EXPOSE_AI_CHAT=1 → :3011).
 *
 * This is the lane NO in-process test covers: every existing svc-ai-chat
 * integration test runs in-process via vitest + a throwaway PostgREST and never
 * starts the container, so the container's OWN env-key-derived serviceable pool
 * (createXBackend from container env → selectServiceableSlugs) is never exercised.
 * With the provider-key sourcing fix, that pool is REAL ({openai, anthropic,
 * google} when their keys are present in .env-prod-backup/.env.coolify).
 *
 * Skips unless SVC_AI_CHAT_URL is set (e.g. http://localhost:3011) — so normal
 * CI/offline runs are unaffected; the dedicated realstack runner sets it.
 *
 * @module
 */
import { describe, it, expect } from 'vitest';

const BASE = process.env.SVC_AI_CHAT_URL;            // e.g. http://localhost:3011
const RUN = BASE ? describe : describe.skip;

RUN('svc-ai-chat container — real dev stack (LOCAL_EXPOSE_AI_CHAT=1)', () => {
  it('GET /health → ok (container is up + reachable on the exposed host port)', async () => {
    const r = await fetch(`${BASE}/health`);
    expect(r.status, await r.clone().text().catch(() => '')).toBe(200);
    const j = (await r.json()) as { status?: string; service?: string };
    expect(j.status).toBe('ok');
    expect(j.service).toBe('svc-ai-chat');
  });
});
