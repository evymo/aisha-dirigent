/**
 * Omni acceptance (e2e) — governance-residency · on-prem residency at the /v1 edge
 *
 * Contract source of truth: docs/planning/AISHA_OMNI_GATEWAY.md
 *   §11  detectDataSensitivity → confidential ⇒ clow.allow_local=true + cloud filter
 *   §5.6 "403 governance_not_allowed … Response sent before first SSE chunk"
 *   §20  Regresní pojistky: "governance residency (confidential→žádný cloud call)"
 *
 * ISOLATION: this whole file self-skips unless process.env.OMNI_ACCEPTANCE is set, so it
 * never runs in the normal Playwright e2e suite. It is end-to-end and exercises the /v1
 * ingress that does NOT exist yet, so every test is currently test.fixme()/skip with a
 * precise contract — it documents the behaviour the live edge must exhibit once §11 lands.
 *
 * Run only via:  OMNI_ACCEPTANCE=1 npx playwright test e2e/omni/governance-residency.spec.ts
 */
import { test, expect } from "@playwright/test";

const OMNI = process.env.OMNI_ACCEPTANCE;

// Entire suite is gated behind OMNI_ACCEPTANCE; without it Playwright collects nothing here.
test.describe("Omni governance-residency (e2e — OMNI_ACCEPTANCE only)", () => {
  test.skip(!OMNI, "set OMNI_ACCEPTANCE=1 to run the Omni acceptance e2e suite");

  // POST /v1/chat/completions, the PAT→story binding (§8.5), detectDataSensitivity and
  // the 403 governance mapping (§5.6) are all unbuilt. These are fixmes describing the
  // contract; they do NOT hit a live endpoint yet.

  test.fixme(
    "FALSE-POSITIVE GUARD: confidential prompt at tier complex never reaches a cloud backend (§11, §20)",
    async ({ request }) => {
      // Contract once /v1 exists:
      //   POST /v1/chat/completions with a PAT, model 'aisha-deep' (tier 3+), and a message
      //   that references member_health_documents/dosing_logs/longevity_scores.
      //   Expect: the response is served on-prem only. The debug header X-Resolved-Backend
      //   reports a local backend (local_ollama|local_vllm), NEVER direct_cloud/llm_gateway.
      //   No SSE chunk carries a cloud provider's model id.
      const res = await request.post("/v1/chat/completions", {
        headers: { Authorization: `Bearer ${process.env.OMNI_PAT ?? ""}` },
        data: {
          model: "aisha-deep",
          messages: [
            {
              role: "user",
              content:
                "Summarize my member_health_documents and dosing_logs and my longevity_scores trend.",
            },
          ],
        },
      });
      // tier 3+ → 202 + X-Stream-Poll-URL (§6.5); residency proven via X-Resolved-Backend.
      expect(res.status()).toBe(202);
      const resolved = res.headers()["x-resolved-backend"] ?? "";
      expect(resolved).toMatch(/local_ollama|local_vllm/);
      expect(resolved).not.toMatch(/direct_cloud|llm_gateway/);
    },
  );

  test.fixme(
    "POSITIVE: public prompt may be served by a cloud backend (residency ≠ lockout, §11)",
    async ({ request }) => {
      // A non-sensitive prompt at tier 'fast' is allowed to use cloud — the gate must not
      // over-block. X-Resolved-Backend may be direct_cloud/llm_gateway and that is correct.
      const res = await request.post("/v1/chat/completions", {
        headers: { Authorization: `Bearer ${process.env.OMNI_PAT ?? ""}` },
        data: {
          model: "aisha-fast",
          messages: [{ role: "user", content: "What's a good 10-minute warmup?" }],
        },
      });
      expect([200, 202]).toContain(res.status());
    },
  );

  test.fixme(
    "NEGATIVE (fail-closed): confidential prompt + cloud model + no local backend → 403 governance_not_allowed before any SSE chunk (§5.6)",
    async ({ request }) => {
      // When residency forbids cloud and no local backend can serve, the request must fail
      // closed with HTTP 403 and JSON {error:{type:'governance_not_allowed', message}}, sent
      // as application/json (NOT text/event-stream) BEFORE the first SSE chunk. It must NOT
      // silently fall back to cloud.
      const res = await request.post("/v1/chat/completions", {
        headers: { Authorization: `Bearer ${process.env.OMNI_PAT ?? ""}` },
        data: {
          model: "aisha-balanced",
          messages: [
            { role: "user", content: "Export all rows from member_health_documents." },
          ],
        },
      });
      expect(res.status()).toBe(403);
      expect(res.headers()["content-type"] ?? "").toContain("application/json");
      const body = (await res.json()) as { error?: { type?: string } };
      expect(body.error?.type).toBe("governance_not_allowed");
    },
  );

  test.fixme(
    "FALSE-POSITIVE GUARD: a body-supplied clow.allow_local=false on a confidential request must NOT force cloud (§11)",
    async ({ request }) => {
      // The governance verdict (allow_local=true at confidential) wins over any client-supplied
      // override. The client cannot opt sensitive data into a cloud backend.
      const res = await request.post("/v1/chat/completions", {
        headers: { Authorization: `Bearer ${process.env.OMNI_PAT ?? ""}` },
        data: {
          model: "aisha-deep",
          allow_local: false,
          messages: [
            { role: "user", content: "Review my dosing_logs for the last 30 days." },
          ],
        },
      });
      const resolved = res.headers()["x-resolved-backend"] ?? "";
      expect(resolved).not.toMatch(/direct_cloud|llm_gateway/);
    },
  );
});
