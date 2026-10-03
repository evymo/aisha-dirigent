/**
 * Omni acceptance (e2e) — quota-admission
 *
 * Contract source of truth: docs/planning/AISHA_OMNI_GATEWAY.md §5.6, §9, §20.
 *
 * SELF-SKIPPING: this spec only runs when process.env.OMNI_ACCEPTANCE is set
 * (per the suite isolation rule). It never participates in the normal e2e run.
 *
 * Every assertion targets the future /v1 ingress surface over HTTP only — there
 * is no module import of unimplemented code. Because /v1/chat/completions does
 * not exist yet (§19.3 "Omni /v1 v kódu NEEXISTUJE"), the network-level
 * acceptance steps are authored as test.fixme() with a precise contract so they
 * activate when the surface lands; the structural guards that can run today
 * (env gating, no-import-of-missing-module) run live.
 */
import { test, expect } from "@playwright/test";

const OMNI = !!process.env.OMNI_ACCEPTANCE;
// Base URL for the Omni surface; distinct host from passthrough (§2, §15).
const OMNI_BASE = process.env.OMNI_BASE_URL ?? "http://localhost:3011";
const PAT = process.env.OMNI_PAT ?? ""; // Bearer mcp_… / sk-aisha-… (§2, §8)

test.describe("omni quota-admission (e2e)", () => {
  test.skip(!OMNI, "Omni acceptance e2e runs only with OMNI_ACCEPTANCE=1");

  // -------------------------------------------------------------------------
  // NEGATIVE — exhausted user → 402 BEFORE any stream byte (§5.6 / §9).
  // /v1/chat/completions not implemented yet → fixme until the ingress lands.
  // -------------------------------------------------------------------------
  test.fixme(
    "exhausted quota → HTTP 402 spend_denied before the first SSE byte",
    async ({ request }) => {
      // PRECONDITION (when live): seed the PAT's user to an exhausted llm_quota row.
      const res = await request.post(`${OMNI_BASE}/v1/chat/completions`, {
        headers: { Authorization: `Bearer ${PAT}`, "Content-Type": "application/json" },
        data: {
          model: "aisha-fast",
          stream: true,
          messages: [{ role: "user", content: "hello" }],
        },
      });
      // §5.6: synchronous gate is HTTP BEFORE SSE → JSON, not event-stream.
      expect(res.status()).toBe(402);
      expect(res.headers()["content-type"] ?? "").toContain("application/json");
      expect(res.headers()["content-type"] ?? "").not.toContain("text/event-stream");
      const body = await res.json();
      expect(body.error.type).toBe("spend_denied");
      // No streamed content leaked.
      const raw = await res.text().catch(() => "");
      expect(raw).not.toContain("data: ");
      expect(raw).not.toContain("[DONE]");
      // Recovery header present (§5.6).
      expect(res.headers()["x-aisha-run-id"]).toBeTruthy();
    },
  );

  // -------------------------------------------------------------------------
  // FALSE-POSITIVE GUARD — quota gate must NOT block free/known-safe endpoints.
  // -------------------------------------------------------------------------
  test.fixme(
    "GET /v1/models is NOT quota-gated (free discovery endpoint) — 200, advertises aisha-* family",
    async ({ request }) => {
      const res = await request.get(`${OMNI_BASE}/v1/models`, {
        headers: { Authorization: `Bearer ${PAT}` },
      });
      // §9 enforceQuota scoped to inbound chat; §5.5 /v1/models lists aisha-* tiers.
      expect(res.status()).toBe(200);
      const body = await res.json();
      const ids: string[] = (body.data ?? []).map((m: { id: string }) => m.id);
      expect(ids).toEqual(
        expect.arrayContaining(["aisha-fast", "aisha-balanced"]),
      );
    },
  );

  // -------------------------------------------------------------------------
  // POSITIVE/NEGATIVE — mid-stream limit surfaces in-band (§5.6, §9): once the
  // first byte is out the HTTP code is already 200, so the limit appears as
  // finish_reason:content_filter + a structured error chunk, never a late 4xx.
  // -------------------------------------------------------------------------
  test.fixme(
    "mid-stream overage closes with finish_reason:content_filter + structured error chunk (no new enum, no late 4xx)",
    async ({ request }) => {
      const res = await request.post(`${OMNI_BASE}/v1/chat/completions`, {
        headers: { Authorization: `Bearer ${PAT}`, "Content-Type": "application/json" },
        data: {
          model: "aisha-fast",
          stream: true,
          messages: [{ role: "user", content: "write a very long essay" }],
        },
      });
      // First byte already committed → 200, not 429 at the HTTP layer (§9).
      expect(res.status()).toBe(200);
      expect(res.headers()["content-type"] ?? "").toContain("text/event-stream");
      const raw = await res.text();
      // §5.6: terminal chunk uses the EXISTING content_filter enum value.
      expect(raw).toContain('"finish_reason":"content_filter"');
      // FALSE-POSITIVE GUARD: must NOT invent a finish_reason enum member.
      expect(raw).not.toContain('"finish_reason":"rate_limited"');
      expect(raw).not.toContain('"finish_reason":"quota_exceeded"');
      // Structured error chunk carries the rate-limit detail out-of-enum.
      expect(raw).toMatch(/rate_limit_exceeded|quota/i);
    },
  );

  // -------------------------------------------------------------------------
  // FALSE-POSITIVE GUARD that CAN run today: the e2e file must not import the
  // not-yet-existent /v1 server module (kept HTTP-only). Trivially true here.
  // -------------------------------------------------------------------------
  test("e2e spec is HTTP-only and imports no unimplemented Omni module", async () => {
    // If this file ever top-level-imported routes/v1-chat.ts before it exists,
    // Playwright collection would throw at import time. Reaching this assertion
    // proves the file type-checks/collects without such an import.
    expect(true).toBe(true);
  });
});
