/**
 * Omni acceptance — streaming-routing — POST /v1/chat/completions: SSE vs 202 contract.
 *
 * AREA: Mandatory complexity routing as a contract (spec §6.5, §5, §4.1/4.2, §20 P0 #7).
 * KIND: integration. SKIP-UNTIL-IMPL — `/v1/chat/completions` does NOT exist yet
 *   (no routes/v1-chat.ts; §19 "Omni /v1 v kódu NEEXISTUJE"). These specs encode the
 *   exact wire contract the route must satisfy, expressed at the HTTP level so the
 *   file never top-level-imports a non-existent module.
 *
 * Activation: when routes/v1-chat.ts ships, replace OMNI_V1_URL plumbing + drop
 *   `.skip`. Tests hit a live Omni base URL (env OMNI_V1_URL) with a PAT (env
 *   OMNI_PAT, prefix `mcp_`/`sk-aisha-` per §8) and assert the contract below.
 *
 * CONTRACT (the source of truth — §5, §6.5):
 *   Tier 1/2 (greeting|simple|moderate → models aisha-fast / aisha-balanced):
 *     • HTTP 200, Content-Type: text/event-stream
 *     • first content byte on wire < 500ms p95 after headers (§6.5 instrumentace)
 *     • each SSE frame = `data: {chat.completion.chunk}` with
 *         id="chatcmpl-aisha-<runid>", object="chat.completion.chunk",
 *         created=<unix>, model="<requested-tier>",
 *         choices[0]={index:0, delta:{content:"…"}, finish_reason:null}
 *     • final frame finish_reason="stop", then literal `data: [DONE]`
 *     • model echoes the REQUESTED tier, never a silent fallback (§5.5);
 *       resolved backend exposed only via X-Resolved-Backend debug header.
 *   Tier 3+ (complex|deep_analysis → aisha-deep / aisha-reasoning):
 *     • HTTP 202 (NOT a hanging SSE), header X-Stream-Poll-URL = /reflect/runs/{id}
 *       (or WS /realtime/v1), header X-AISHA-Run-ID present (§5.6)
 *     • NO text/event-stream body opened on the initial response
 *     • a tier3+ request must NEVER hold an idle token-SSE past client timeout
 *       (Claude Code ~30s / Cursor ~60s / Continue ~120s — §6.5).
 */
import { describe, it, expect } from "vitest";

const OMNI_V1_URL = process.env.OMNI_V1_URL ?? "";
const OMNI_PAT = process.env.OMNI_PAT ?? "";

// Skip-until-impl: route does not exist. When live, also requires OMNI_V1_URL+OMNI_PAT.
describe.skip("[omni][streaming-routing] POST /v1/chat/completions stream-vs-202 (skip-until-impl §6.5/§5)", () => {
  const completionsUrl = () => `${OMNI_V1_URL.replace(/\/$/, "")}/v1/chat/completions`;
  const authHeaders = () => ({
    "content-type": "application/json",
    authorization: `Bearer ${OMNI_PAT}`,
  });

  // ── POSITIVE: tier1/2 → SSE with correct chunk shape + finish_reason + [DONE]
  it.todo(
    "POSITIVE tier1/2 (aisha-fast): 200 text/event-stream, chunks are chat.completion.chunk, " +
      "id=chatcmpl-aisha-<runid>, delta.content present, final finish_reason:stop, then data: [DONE]",
    async () => {
      const res = await fetch(completionsUrl(), {
        method: "POST",
        headers: authHeaders(),
        body: JSON.stringify({
          model: "aisha-fast",
          stream: true,
          messages: [{ role: "user", content: "hi" }],
        }),
      });
      expect(res.status).toBe(200);
      expect(res.headers.get("content-type")).toMatch(/text\/event-stream/);

      const text = await res.text();
      const dataFrames = text
        .split("\n")
        .filter((l) => l.startsWith("data: "))
        .map((l) => l.slice("data: ".length).trim());

      expect(dataFrames.at(-1)).toBe("[DONE]");
      const jsonFrames = dataFrames.filter((f) => f !== "[DONE]").map((f) => JSON.parse(f));
      expect(jsonFrames.length).toBeGreaterThan(0);
      for (const c of jsonFrames) {
        expect(c.object).toBe("chat.completion.chunk");
        expect(c.id).toMatch(/^chatcmpl-aisha-/);
        expect(typeof c.created).toBe("number");
        expect(c.model).toBe("aisha-fast"); // §5.5: echo requested tier, never fallback
        expect(c.choices[0].index).toBe(0);
      }
      const last = jsonFrames.at(-1);
      expect(last.choices[0].finish_reason).toBe("stop");
      // non-final chunks carry finish_reason:null
      expect(jsonFrames[0].choices[0].finish_reason).toBeNull();
    },
  );

  it.todo(
    "POSITIVE: response 'model' echoes requested tier; resolved backend only in X-Resolved-Backend (§5.5)",
  );

  // ── POSITIVE: tier3+ → 202 + X-Stream-Poll-URL (NOT a hanging stream)
  it.todo(
    "POSITIVE tier3+ (aisha-deep): 202, X-Stream-Poll-URL=/reflect/runs/{id}, X-AISHA-Run-ID set, " +
      "Content-Type is NOT text/event-stream",
    async () => {
      const res = await fetch(completionsUrl(), {
        method: "POST",
        headers: authHeaders(),
        body: JSON.stringify({
          model: "aisha-deep",
          stream: true,
          messages: [
            {
              role: "user",
              content:
                "Analyze the trade-offs between these architectures and recommend a refactor " +
                "in detail; explain why the migration deadlocks under concurrent INSERTs.",
            },
          ],
        }),
      });
      expect(res.status).toBe(202);
      expect(res.headers.get("content-type")).not.toMatch(/text\/event-stream/);
      const pollUrl = res.headers.get("x-stream-poll-url");
      expect(pollUrl).toBeTruthy();
      expect(pollUrl).toMatch(/\/reflect\/runs\/[0-9a-f-]{36}/i);
      expect(res.headers.get("x-aisha-run-id")).toMatch(/[0-9a-f-]{36}/i);
    },
  );

  // ── NEGATIVE: tier3+ must never open a token SSE that idles past client timeout
  it.todo(
    "NEGATIVE tier3+: must NOT open a token SSE; if a stream is opened it must not idle " +
      "past the shortest client timeout (~30s Claude Code). Asserted by: status===202 (no stream), " +
      "OR (if streamed) a keep-alive/terminal frame arrives < 30s — never an indefinite idle.",
  );

  // ── NEGATIVE: eager-resolver outage fails CLOSED with 503, not a bogus 202
  it.todo(
    "NEGATIVE: when the eager resolver (aisha_resolve_clow_backend + classifyMessageComplexity) " +
      "is unavailable, /v1/chat/completions returns 503 — never 202 with a NULL backend (§4.1/§4.2).",
  );

  // ── FALSE-POSITIVE GUARD: a prompt mis-classified as simple must not silently
  //    downgrade a complex orchestrated task. The eager resolver (§4.2) couples
  //    classifier + backend so a "simple" verdict cannot commit a stream lane when
  //    the resolver picks a cloud/orchestrated backend. Boundary guard, not vibes.
  it.todo(
    "FALSE-POSITIVE GUARD: a borderline prompt that classifies 'simple' but whose eager " +
      "resolver selects an orchestrated backend must NOT silently stream — it escalates to the " +
      "202 lane (eager resolver reconciles lane+backend together, §4.2 'jinak rozpor').",
  );

  // ── FALSE-POSITIVE GUARD: a body-supplied tier must not override the classifier's
  //    mandatory routing into a cheaper stream lane (anti-downgrade, §6.5 contract).
  it.todo(
    "FALSE-POSITIVE GUARD: requesting model:'aisha-fast' on an objectively complex prompt does " +
      "NOT force the cheap stream lane — mandatory complexity routing still applies (§6.5 'POVINNÝ').",
  );
});
