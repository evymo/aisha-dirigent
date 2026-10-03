/**
 * AISHA Omni — e2e acceptance · area: pat-tenancy
 * Spec source of truth: docs/planning/AISHA_OMNI_GATEWAY.md (v4) §8, §8.5, §16, §20.
 *
 * ISOLATION: this spec lives under e2e/omni/ and SELF-SKIPS unless process.env.OMNI_ACCEPTANCE
 * is set, so a normal Playwright run never executes it.
 *
 * LIVE vs SKIP: the OpenAI/Anthropic /v1 ingress (POST /v1/chat/completions, POST /v1/messages)
 * DOES NOT EXIST yet (spec §19: "Omni /v1 v kódu NEEXISTUJE"). Therefore every assertion here is
 * test.fixme(...) with a precise HTTP-level contract and NO import of any non-existent app module —
 * the spec only ever speaks to the gateway over HTTP via request fixtures. When /v1 lands, point
 * OMNI_BASE_URL at the running Omni edge and convert fixme → real assertions.
 *
 * Real identifiers: route POST /v1/chat/completions, POST /v1/messages; PAT prefix mcp_;
 * error bodies {"error":"story_mismatch"} / {"error":"unscoped_token"}; header X-AISHA-Run-ID;
 * poll URL /reflect/runs/{id}; tables mcp_auth_tokens.scoped_to_story_id, ai_runs.story_id.
 */
import { test, expect } from "@playwright/test";

const ACCEPTANCE = Boolean(process.env.OMNI_ACCEPTANCE);
const BASE = process.env.OMNI_BASE_URL ?? "http://localhost:3011";

// Fixtures (bound at issuance; replace with shared seed once available):
const PAT_SCOPED_A = process.env.OMNI_PAT_SCOPED_A ?? "mcp_e2e_scoped_storyA";
const PAT_UNSCOPED = process.env.OMNI_PAT_UNSCOPED ?? "mcp_e2e_unscoped";
const STORY_A = process.env.OMNI_STORY_A ?? "00000000-0000-4000-8000-0000000000a1";
const STORY_B = process.env.OMNI_STORY_B ?? "00000000-0000-4000-8000-0000000000b2";

test.describe("Omni acceptance · pat-tenancy multi-tenant isolation matrix (§8.5/§16/§20)", () => {
  test.skip(!ACCEPTANCE, "Omni acceptance e2e — set OMNI_ACCEPTANCE=1 to run");

  test.fixme(
    "positive: scoped PAT(A) + no body story → 200, run.story_id = STORY_A (derived from PAT)",
    async ({ request }) => {
      // §8.5: derive story from PAT; no body story_id. Expect 200 + X-AISHA-Run-ID; the run is story A.
      const res = await request.post(`${BASE}/v1/chat/completions`, {
        headers: { Authorization: `Bearer ${PAT_SCOPED_A}` },
        data: { model: "aisha-fast", messages: [{ role: "user", content: "ping" }] },
      });
      expect(res.ok()).toBeTruthy();
      const runId = res.headers()["x-aisha-run-id"];
      expect(runId, "X-AISHA-Run-ID must be present for recovery (§5.6)").toBeTruthy();
      const poll = await request.get(`${BASE}/reflect/runs/${runId}`);
      const run = await poll.json();
      expect(run.story_id, "run story_id must equal the PAT scope").toBe(STORY_A);
    },
  );

  test.fixme(
    "false-positive guard: scoped PAT(A) + body story_id=B → 403 story_mismatch (body must NOT override)",
    async ({ request }) => {
      // §8.5 "ignorovat/validovat body": a body-supplied foreign story_id MUST NOT be accepted.
      const res = await request.post(`${BASE}/v1/chat/completions`, {
        headers: { Authorization: `Bearer ${PAT_SCOPED_A}` },
        data: { model: "aisha-fast", story_id: STORY_B, messages: [{ role: "user", content: "ping" }] },
      });
      expect(res.status()).toBe(403);
      expect((await res.json()).error).toBe("story_mismatch");
    },
  );

  test.fixme(
    "negative: unscoped PAT + no body story → 403 unscoped_token (fail-closed)",
    async ({ request }) => {
      // §8.5 "fail-closed když neurčeno": NULL scoped_to_story_id + no body story → no inference, hard 403.
      const res = await request.post(`${BASE}/v1/chat/completions`, {
        headers: { Authorization: `Bearer ${PAT_UNSCOPED}` },
        data: { model: "aisha-fast", messages: [{ role: "user", content: "ping" }] },
      });
      expect(res.status()).toBe(403);
      expect((await res.json()).error).toBe("unscoped_token");
    },
  );

  test.fixme(
    "positive: scoped PAT(A) + body story_id=A (matching) → 200 (body ignored, not 403)",
    async ({ request }) => {
      // A matching body value is harmless: story derived from token; no mismatch. → 200.
      const res = await request.post(`${BASE}/v1/chat/completions`, {
        headers: { Authorization: `Bearer ${PAT_SCOPED_A}` },
        data: { model: "aisha-fast", story_id: STORY_A, messages: [{ role: "user", content: "ping" }] },
      });
      expect(res.ok()).toBeTruthy();
    },
  );

  test.fixme(
    "invariant: every successful /v1 dispatch yields ai_runs.story_id NOT NULL (§16/§20)",
    async ({ request }) => {
      const res = await request.post(`${BASE}/v1/chat/completions`, {
        headers: { Authorization: `Bearer ${PAT_SCOPED_A}` },
        data: { model: "aisha-fast", messages: [{ role: "user", content: "ping" }] },
      });
      const runId = res.headers()["x-aisha-run-id"];
      const run = await (await request.get(`${BASE}/reflect/runs/${runId}`)).json();
      expect(run.story_id, "ai_runs.story_id must never be null").not.toBeNull();
    },
  );

  test.fixme(
    "false-positive guard: /v1/messages (Anthropic) scoped PAT(A) + foreign story → 403 story_mismatch",
    async ({ request }) => {
      // Anthropic surface funnels into the SAME story-binding gate (§5). Foreign story → 403.
      const res = await request.post(`${BASE}/v1/messages`, {
        headers: { Authorization: `Bearer ${PAT_SCOPED_A}` },
        data: {
          model: "aisha-fast",
          max_tokens: 16,
          metadata: { story_id: STORY_B },
          messages: [{ role: "user", content: "ping" }],
        },
      });
      expect(res.status()).toBe(403);
      expect((await res.json()).error).toBe("story_mismatch");
    },
  );
});
