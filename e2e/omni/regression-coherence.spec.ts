/**
 * Omni acceptance (e2e) — regression-coherence — existing surfaces still work + stay coherent.
 *
 * AREA: §19 (one engine, many surfaces), §0.5/§19.4 (public-chat out of governance), §6.5 (tier1/2 unchanged).
 * SELF-SKIPS unless process.env.OMNI_ACCEPTANCE is set (isolation rule).
 *
 * Activation: OMNI_ACCEPTANCE=1, OMNI_BASE_URL (edge), optional OMNI_PAT + OMNI_PUBLIC_CHAT_SLUG.
 *
 * These guard that the Omni changes (streaming inversion, complexity-routing wiring, broadcast
 * triggers, PAT binding, governance gate) do NOT regress the pre-Omni one-engine behavior.
 */
import { test, expect } from "@playwright/test";

const RUN = !!process.env.OMNI_ACCEPTANCE;
const BASE = (process.env.OMNI_BASE_URL ?? "").replace(/\/$/, "");
const PAT = process.env.OMNI_PAT ?? "";

test.describe("[omni][regression-coherence] existing ingress unchanged + coherent", () => {
  test.skip(!RUN, "Omni acceptance e2e disabled (set OMNI_ACCEPTANCE=1 + OMNI_BASE_URL)");

  // POSITIVE — the engine service stays healthy after the Omni changes.
  test("POSITIVE: engine health endpoint responds (no service regression)", async ({ request }) => {
    const res = await request.get(`${BASE}/health`);
    expect(res.status()).toBeLessThan(500);
  });

  // POSITIVE — tier1/2 still streams synchronously (the wiring only changes tier3+).
  test("POSITIVE: a greeting/simple turn still streams synchronously (tier1/2 unchanged)", async ({ request }) => {
    test.skip(!PAT, "needs OMNI_PAT");
    const res = await request.post(`${BASE}/v1/chat/completions`, {
      headers: { authorization: `Bearer ${PAT}`, "content-type": "application/json" },
      data: { model: "aisha-fast", stream: true, messages: [{ role: "user", content: "hi" }] },
    });
    expect(res.status()).toBe(200); // NOT 202 — simple turns keep the sync streaming lane
    expect(res.headers()["content-type"]).toMatch(/text\/event-stream/);
  });

  // FALSE-POSITIVE GUARD — public-chat must stay anonymous: it must NOT require a PAT
  // nor begin enforcing story/governance after the Omni work.
  test("FALSE-POSITIVE GUARD: public-chat stays anonymous (no PAT, no story/governance)", async ({ request }) => {
    const slug = process.env.OMNI_PUBLIC_CHAT_SLUG ?? "default";
    const res = await request.post(`${BASE}/functions/v1/public-chat`, {
      headers: { "content-type": "application/json" },
      data: { message: "hello", channel_slug: slug },
    });
    // Anonymous path: NOT 401/403 (it must not start demanding auth/story scope).
    expect([401, 403]).not.toContain(res.status());
  });
});
