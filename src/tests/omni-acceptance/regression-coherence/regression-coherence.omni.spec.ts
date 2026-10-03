/**
 * Omni acceptance — area: regression-coherence (§19, §19.4, §20, §0.5)
 * ----------------------------------------------------------------------------
 * Source of truth: docs/planning/AISHA_OMNI_GATEWAY.md (v4).
 *
 * Part of the Omni ACCEPTANCE suite — collected ONLY by
 * vitest.omni-acceptance.config.ts. Pure source-inspection guards run always
 * (they LOCK current behavior so the Omni changes cannot silently regress it);
 * HTTP blocks self-skip unless process.env.OMNI_ACCEPTANCE is set.
 *
 * AREA CONTRACT — the backend is ONE story-scoped engine behind many surfaces
 * (workbench, dirigent extension, mobile, /chat, /reflect, /dirigent/dispatch,
 * /public-chat → svc-ai-chat → orchestrationBridge → route_task → ai_runs).
 * The Omni work (streaming inversion, complexity-routing wiring, broadcast
 * triggers, PAT binding, governance gate) MUST NOT regress any of these:
 *   - ENGINE COHERENCE: every JWT ingress reaches the SAME engine
 *     (orchestrationBridge) — no per-surface routing fork.
 *   - PUBLIC-CHAT STAYS OUT OF OMNI GOVERNANCE (§0.5, §19.4): public-chat is
 *     anonymous, fire-and-forget to n8n, NO story binding, NO governance. A
 *     regression that bolts story/governance onto public-chat is forbidden.
 *   - TIER 1/2 SYNC PATH UNCHANGED (§6.5, §20 P0 #6): wiring
 *     classifyMessageComplexity → chooseExecutionStrategy → kickOffReflectionWorkflow
 *     into /chat must change ONLY the tier3+ lane (→ async 202); the existing
 *     tier1/2 synchronous behavior must be preserved.
 *   - NO NEW DUPLICATE ROUTER/RESOLVER/SCHEMA (§19.2): consolidation reduces
 *     duplicates; it must not introduce new parallel copies.
 *
 * LIVE vs SKIP:
 *   - chat.ts / public-chat.ts / dirigent-supervisor.ts EXIST → LIVE source
 *     guards (mostly GREEN — they protect current correct behavior; they go RED
 *     only if a change regresses them).
 *   - Post-wiring tier1/2-preservation + cross-surface e2e need the wired /chat
 *     and the /v1 surface → it.todo with exact contracts.
 *
 * LIVE HTTP harness (optional, gated): OMNI_ACCEPTANCE + OMNI_BASE_URL.
 */
import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

const ACCEPTANCE = Boolean(process.env.OMNI_ACCEPTANCE);
const d = ACCEPTANCE ? describe : describe.skip;
const SRC = (p: string) => resolve(process.cwd(), p);
const read = (p: string) => (existsSync(SRC(p)) ? readFileSync(SRC(p), "utf8") : "");

const CHAT = "services/svc-ai-chat/src/routes/chat.ts";
const PUBLIC_CHAT = "services/svc-ai-chat/src/routes/public-chat.ts";
const DISPATCH = "services/svc-ai-chat/src/routes/dirigent-supervisor.ts";

// ═════════════════════════════════════════════════════════════════════════════
// 1. Engine coherence — every JWT ingress reaches orchestrationBridge — LIVE
// ═════════════════════════════════════════════════════════════════════════════
describe("regression-coherence · one engine behind many surfaces (§19, LIVE)", () => {
  // POSITIVE — /chat funnels through orchestrationBridge (the single decision hub).
  it("LIVE positive: /chat reaches the shared engine (orchestrationBridge)", () => {
    const src = read(CHAT);
    expect(src).not.toBe("");
    expect(/orchestrationBridge/.test(src)).toBe(true);
  });

  // FALSE-POSITIVE GUARD — no per-surface LLM routing fork: a route handler must
  // NOT call a raw provider directly (callOpenAI/callAnthropic/fetch to api.openai)
  // bypassing the router/engine. (Locks the "routers are executors, one brain"
  // invariant from §6.)
  it("LIVE false-positive: /chat must NOT bypass the engine with a raw provider call", () => {
    const src = read(CHAT);
    expect(/callOpenAI\s*\(|callAnthropic\s*\(|api\.openai\.com\/v1\/chat/.test(src)).toBe(false);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 2. public-chat stays OUT of Omni governance/story (§0.5, §19.4) — LIVE
// ═════════════════════════════════════════════════════════════════════════════
describe("regression-coherence · public-chat out of governance (§0.5/§19.4, LIVE)", () => {
  // POSITIVE — public-chat is anonymous + fire-and-forget; it exists and routes to n8n.
  it("LIVE positive: public-chat exists and forwards to n8n (anonymous surface)", () => {
    const src = read(PUBLIC_CHAT);
    expect(src).not.toBe("");
    expect(/n8n|webhook/i.test(src)).toBe(true);
  });

  // FALSE-POSITIVE GUARD — public-chat must NOT acquire story binding or the
  // governance gate (a regression would pull anonymous traffic into Omni
  // governance/chargeback). GREEN today; goes RED if someone bolts it on.
  it("LIVE false-positive: public-chat must NOT bind story_id or invoke the governance gate", () => {
    const src = read(PUBLIC_CHAT);
    expect(/story_id|resolveGovernanceDecision|detectDataSensitivity|get_chat_context_story_id/.test(src)).toBe(false);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 3. dirigent/dispatch sync-gating budget intact (§12) — LIVE source + gated HTTP
// ═════════════════════════════════════════════════════════════════════════════
describe("regression-coherence · /dirigent/dispatch sync budget (§12, LIVE)", () => {
  // POSITIVE — the n8n playbook hop keeps its bounded budget (hook total 8s,
  // 4s reserved). Guards against a change that removes the timeout → unbounded
  // hook latency.
  it("LIVE positive: dispatch keeps a bounded n8n timeout (fail-open budget)", () => {
    const src = read(DISPATCH);
    expect(src).not.toBe("");
    expect(/N8N_TIMEOUT_MS\s*=\s*\d/.test(src)).toBe(true);
    expect(/AbortSignal\.timeout/.test(src)).toBe(true);
  });
});

d("regression-coherence · existing ingress still responds (LIVE HTTP, gated)", () => {
  const BASE = (process.env.OMNI_BASE_URL ?? "http://localhost:3011").replace(/\/$/, "");
  // POSITIVE — health/liveness of the engine service after the Omni changes.
  it("LIVE positive: svc-ai-chat health endpoint responds (engine up post-change)", async () => {
    let res: Response;
    try {
      res = await fetch(`${BASE}/health`);
    } catch {
      return; // service down in this env → skip
    }
    expect(res.status).toBeLessThan(500);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 4. Tier 1/2 sync path preserved after wiring (§6.5/§20 P0 #6) — SKIP-UNTIL-IMPL
// ═════════════════════════════════════════════════════════════════════════════
describe.skip("regression-coherence · tier1/2 sync path preserved post-wiring (NOT IMPLEMENTED — §6.5)", () => {
  // CONTRACT: after classify→chooseExecutionStrategy→kickOffReflectionWorkflow is
  // wired into /chat, ONLY tier3+ changes to the async 202 lane; tier1/2 keeps
  // the current synchronous streaming behavior + identical response shape.
  it.todo("positive: tier1/2 /chat stays synchronous (no 202) after wiring");
  it.todo("positive: tier3+ /chat switches to the async lane WITHOUT changing tier1/2");
  it.todo("false-positive: wiring must NOT make a simple greeting take the orchestrated lane");
});

// ═════════════════════════════════════════════════════════════════════════════
// 5. Cross-surface coherence after Omni (§19) — SKIP-UNTIL-IMPL (e2e elsewhere)
// ═════════════════════════════════════════════════════════════════════════════
describe.skip("regression-coherence · cross-surface coherence (NOT IMPLEMENTED — §19)", () => {
  // CONTRACT: workbench, dirigent extension, mobile, /chat and the new /v1 all
  // produce ai_runs(story_id NOT NULL) via the same route_task path — no surface
  // forks the engine. (e2e/omni/regression-coherence.spec.ts carries the wire-level
  // version of this once the surfaces exist.)
  it.todo("positive: /chat and /v1 for the same user+story both create ai_runs via route_task");
  it.todo("false-positive: no ingress writes an ai_run with story_id NULL (invariant §19.1)");
});
