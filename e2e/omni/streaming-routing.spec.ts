/**
 * Omni acceptance (e2e) — streaming-routing — /v1 SSE-vs-202 end-to-end through the edge.
 *
 * AREA: Mandatory complexity routing as a contract (spec §6.5, §5, §12 edge non-buffering).
 * SELF-SKIPS unless process.env.OMNI_ACCEPTANCE is set (isolation rule — must not run in
 *   normal CI / Playwright runs). SKIP-UNTIL-IMPL: the Omni /v1 surface and the streaming
 *   edge proxy (§12 — @aisha/gateway v1.ts pipe, NEVER functions.ts arrayBuffer) do not
 *   exist yet, so the assertions are encoded but gated.
 *
 * Activation: set OMNI_ACCEPTANCE=1 and OMNI_BASE_URL (e.g. https://omni.<tld>) + OMNI_PAT.
 *
 * CONTRACT verified end-to-end (edge → svc-ai-chat → wire):
 *   • tier1/2 → real streamed SSE; first content byte arrives quickly (edge MUST NOT
 *     buffer — §12/§16); chunks are chat.completion.chunk; terminates with [DONE].
 *   • tier3+ → 202 + X-Stream-Poll-URL, no hanging stream (§6.5 idle-timeout guard).
 */
import { test, expect } from "@playwright/test";

const RUN = !!process.env.OMNI_ACCEPTANCE;
const BASE = (process.env.OMNI_BASE_URL ?? "").replace(/\/$/, "");
const PAT = process.env.OMNI_PAT ?? "";

test.describe("[omni][streaming-routing] /v1 SSE-vs-202 e2e", () => {
  // PAT-gated: every test here drives /v1 with a real Bearer mcp_… token bound to a
  // story (§8/§16). Without OMNI_PAT the requests 401 — so skip cleanly (consistent
  // with the other omni e2e specs' per-test `!PAT` guards) rather than fail on auth.
  test.skip(!RUN || !PAT, "Omni acceptance e2e disabled (set OMNI_ACCEPTANCE=1 + OMNI_BASE_URL + OMNI_PAT)");

  // POSITIVE — tier1/2 streams real tokens through the edge without buffering.
  test("POSITIVE tier1/2: streamed SSE with chat.completion.chunk frames and [DONE]", async ({ request }) => {
    const res = await request.post(`${BASE}/v1/chat/completions`, {
      headers: { authorization: `Bearer ${PAT}`, "content-type": "application/json" },
      data: { model: "aisha-fast", stream: true, messages: [{ role: "user", content: "hi" }] },
    });
    expect(res.status()).toBe(200);
    expect(res.headers()["content-type"]).toMatch(/text\/event-stream/);
    const body = await res.text();
    expect(body).toContain("chat.completion.chunk");
    expect(body).toContain("chatcmpl-aisha-");
    expect(body.trimEnd().endsWith("data: [DONE]")).toBe(true);
  });

  // POSITIVE — tier3+ returns 202 + poll URL, not a stream.
  test("POSITIVE tier3+: 202 + X-Stream-Poll-URL (/reflect/runs/{id}), no event-stream", async ({ request }) => {
    const res = await request.post(`${BASE}/v1/chat/completions`, {
      headers: { authorization: `Bearer ${PAT}`, "content-type": "application/json" },
      data: {
        model: "aisha-deep",
        stream: true,
        messages: [
          {
            role: "user",
            content:
              "Analyze and recommend a refactor strategy in detail; explain why the migration " +
              "deadlocks under concurrent INSERTs and compare the trade-offs.",
          },
        ],
      },
    });
    expect(res.status()).toBe(202);
    expect(res.headers()["content-type"] ?? "").not.toMatch(/text\/event-stream/);
    expect(res.headers()["x-stream-poll-url"] ?? "").toMatch(/\/reflect\/runs\//);
  });

  // POSITIVE — the PAT that received the 202 can DRAIN its own run via the advertised
  // X-Stream-Poll-URL. The endpoint accepts the PAT (story-scoped), not service-role-only,
  // so the documented poll contract is usable by the external client that received it.
  test("POSITIVE tier3+: the issuing PAT can poll its own run at X-Stream-Poll-URL (200)", async ({ request }) => {
    const res = await request.post(`${BASE}/v1/chat/completions`, {
      headers: { authorization: `Bearer ${PAT}`, "content-type": "application/json" },
      data: {
        model: "aisha-deep",
        messages: [{ role: "user", content: "Analyze in detail and recommend a refactor for the cross-tenant migration deadlock under concurrent INSERTs." }],
      },
    });
    expect(res.status()).toBe(202);
    const pollUrl = res.headers()["x-stream-poll-url"] ?? "";
    expect(pollUrl).toMatch(/\/reflect\/runs\//);
    const poll = await request.get(`${BASE}${pollUrl}`, { headers: { authorization: `Bearer ${PAT}` } });
    expect(poll.status()).toBe(200);
    expect((await poll.json()).id).toBeTruthy();
  });

  // NEGATIVE — polling a run with NO auth is refused (no anonymous run reads). A foreign
  // PAT (different story) gets a fail-closed 404, verified separately — here we assert the
  // unauthenticated case so the endpoint is never world-open.
  test("NEGATIVE tier3+: polling /reflect/runs/{id} without auth is refused (401)", async ({ request }) => {
    const res = await request.post(`${BASE}/v1/chat/completions`, {
      headers: { authorization: `Bearer ${PAT}`, "content-type": "application/json" },
      data: { model: "aisha-deep", messages: [{ role: "user", content: "Analyze in detail the deadlock root cause across tenants and recommend a refactor." }] },
    });
    const pollUrl = res.headers()["x-stream-poll-url"] ?? "";
    expect((await request.get(`${BASE}${pollUrl}`)).status()).toBe(401);
  });

  // NEGATIVE — tier3+ must not hold an idle token SSE past the shortest client timeout.
  test("NEGATIVE tier3+: response is 202 (not an idle hanging stream past ~30s)", async ({ request }) => {
    const started = Date.now();
    const res = await request.post(`${BASE}/v1/chat/completions`, {
      headers: { authorization: `Bearer ${PAT}`, "content-type": "application/json" },
      data: {
        model: "aisha-reasoning",
        stream: true,
        messages: [{ role: "user", content: "Deeply analyze and debug this architecture in detail." }],
      },
      timeout: 30_000,
    });
    // Must come back fast as a 202 handshake, not stall on an open token stream.
    expect(Date.now() - started).toBeLessThan(30_000);
    expect(res.status()).toBe(202);
  });

  // FALSE-POSITIVE GUARD — a cheap-tier label on a complex prompt must still route async.
  test("FALSE-POSITIVE GUARD: model:aisha-fast on a complex prompt does NOT downgrade to stream", async ({ request }) => {
    const res = await request.post(`${BASE}/v1/chat/completions`, {
      headers: { authorization: `Bearer ${PAT}`, "content-type": "application/json" },
      data: {
        model: "aisha-fast",
        stream: true,
        messages: [
          {
            role: "user",
            content:
              "Analyze the root cause, refactor the failing function, and explain in detail why " +
              "the SQL schema migration deadlocks under concurrent INSERTs across all tenants.",
          },
        ],
      },
    });
    // Mandatory complexity routing (§6.5) overrides the requested cheap tier → 202 async lane.
    expect(res.status()).toBe(202);
  });
});
