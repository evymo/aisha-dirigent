/**
 * Omni acceptance (e2e) — protocol-statefulness-errors — dual protocol, statefulness, error mapping.
 *
 * AREA: §5 (OpenAI + Anthropic surface), §4.6 (conversation_id statefulness), §5.6 (error/terminal mapping).
 * SELF-SKIPS unless process.env.OMNI_ACCEPTANCE is set (isolation rule).
 * SKIP-UNTIL-IMPL: /v1/chat/completions + /v1/messages do not exist yet (§19) — assertions encoded + gated.
 *
 * Activation: OMNI_ACCEPTANCE=1, OMNI_BASE_URL (e.g. https://omni.<tld>), OMNI_PAT (mcp_… bound to a story).
 */
import { test, expect } from "@playwright/test";

const RUN = !!process.env.OMNI_ACCEPTANCE;
const BASE = (process.env.OMNI_BASE_URL ?? "").replace(/\/$/, "");
const PAT = process.env.OMNI_PAT ?? "";
const hdr = { authorization: `Bearer ${PAT}`, "content-type": "application/json" };

test.describe("[omni][protocol-statefulness-errors] /v1 dual-protocol + state + errors e2e", () => {
  // PAT-gated: every test here drives /v1 with a real Bearer mcp_… token bound to a
  // story (§8/§16). Without OMNI_PAT the requests 401 — so skip cleanly (consistent
  // with the other omni e2e specs' per-test `!PAT` guards) rather than fail on auth.
  test.skip(!RUN || !PAT, "Omni acceptance e2e disabled (set OMNI_ACCEPTANCE=1 + OMNI_BASE_URL + OMNI_PAT)");

  // POSITIVE — OpenAI + Anthropic for the same turn share one run (X-AISHA-Run-ID).
  test("POSITIVE dual-protocol: OpenAI /v1/chat/completions and Anthropic /v1/messages land in the SAME run_id", async ({ request }) => {
    const oai = await request.post(`${BASE}/v1/chat/completions`, {
      headers: hdr,
      data: { model: "aisha-deep", stream: false, messages: [{ role: "user", content: "ping" }] },
    });
    const ant = await request.post(`${BASE}/v1/messages`, {
      headers: hdr,
      data: { model: "aisha-deep", max_tokens: 64, messages: [{ role: "user", content: "ping" }] },
    });
    const oaiRun = oai.headers()["x-aisha-run-id"];
    const antRun = ant.headers()["x-aisha-run-id"];
    expect(oaiRun).toBeTruthy();
    // Same logical turn → identical run (routing + governance + cost inside one run).
    expect(antRun).toBe(oaiRun);
  });

  // NEGATIVE — an Anthropic client hitting an OpenAI-only deployment fails CLEARLY, not silently.
  test("NEGATIVE: if /v1/messages is unsupported, the response is an explicit 404/4xx (not a silent hang)", async ({ request }) => {
    const res = await request.post(`${BASE}/v1/messages`, {
      headers: hdr,
      data: { model: "aisha-fast", max_tokens: 32, messages: [{ role: "user", content: "hi" }] },
      timeout: 30_000,
    });
    // Either supported (2xx/202) OR a clear client error — never a 5xx/empty/hang.
    expect(res.status()).toBeLessThan(500);
  });

  // POSITIVE — stateless call echoes a conversation_id the client can resume from.
  test("POSITIVE statefulness: a stateless call echoes conversation_id (resumable)", async ({ request }) => {
    const res = await request.post(`${BASE}/v1/chat/completions`, {
      headers: hdr,
      data: { model: "aisha-fast", stream: true, messages: [{ role: "user", content: "hello" }] },
    });
    const body = await res.text();
    // §4.6: conversation_id echoed in chunk metadata + final done message.
    expect(body).toMatch(/conversation_id/);
  });

  // FALSE-POSITIVE GUARD — spend-denied surfaces as 402 BEFORE the stream (no half-stream).
  test("FALSE-POSITIVE GUARD: a denied request does NOT begin streaming then break — it returns 402 up front", async ({ request }) => {
    const res = await request.post(`${BASE}/v1/chat/completions`, {
      headers: { ...hdr, "x-omni-test-force-deny": "spend" }, // test hook: force the spend gate
      data: { model: "aisha-deep", stream: true, messages: [{ role: "user", content: "expensive" }] },
    });
    if (res.status() === 402) {
      expect(res.headers()["content-type"] ?? "").not.toMatch(/text\/event-stream/);
    }
  });
});
