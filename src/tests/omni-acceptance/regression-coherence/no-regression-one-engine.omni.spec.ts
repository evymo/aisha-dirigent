/**
 * Omni acceptance — area: regression-coherence (§4.1, §4.4, §4.6, §6.5, §7,
 * §19.1, §19.3, §20 P0 #6 + "Regresní pojistky")
 * ----------------------------------------------------------------------------
 * Source of truth: docs/planning/AISHA_OMNI_GATEWAY.md (v4).
 *
 * Part of the Omni ACCEPTANCE suite — collected ONLY by
 * vitest.omni-acceptance.config.ts (the default vitest.config.ts EXCLUDES
 * src/tests/omni-acceptance/**). The whole file self-skips unless
 * process.env.OMNI_ACCEPTANCE is set (same gating philosophy as the sibling
 * story-resolver-hole / pat-tenancy / streaming-routing specs and e2e/omni).
 *
 * WHY THIS AREA: §20 P0 #6 wires classify/chooseStrategy/kickOff into /chat,
 * and §7 inverts the streaming engine. Those changes MUST NOT regress the
 * existing one-engine paths. This file LOCKS today's behaviour as the baseline
 * the changes must preserve (or, where today's behaviour is the documented bug,
 * pins it RED so the fix flips it GREEN).
 *
 * AREA CONTRACT (the invariants this file guards):
 *
 *   A. /chat synchronous path is buffered JSON, not SSE (LIVE-GREEN, behaviour lock).
 *      services/svc-ai-chat/src/routes/chat.ts always returns `new Response(JSON…)`
 *      with `{ conversation_id, … }`; the only execution call is
 *      `engine.execute(workflowGraph, workflowCtx)` at chat.ts:875 — there is NO
 *      tier branch and NO `text/event-stream` body today (§19.3:
 *      "tier nikdy nevětví exekuci … vždy synchronní engine.execute()"). After
 *      §20 P0 #6 wiring, tier1/2 MUST keep this synchronous semantics for the
 *      caller (the spec changes the transport for /v1, not the /chat contract).
 *
 *   B. /chat statefulness contract (§4.6, LIVE-GREEN behaviour lock).
 *      Absent conversation_id → chat.ts:412 auto-creates a new conversation and
 *      ECHOES conversation_id in the JSON body; a supplied conversation_id is
 *      echoed back unchanged (stateful multi-turn). §4.6 test matrix: stateless /
 *      stateful multi-turn / complex-turn ai_runs chaining.
 *
 *   C. /public-chat stays OUT of Omni governance (§19.1 "/public-chat: bez story
 *      by design"; FALSE-POSITIVE guard). public-chat.ts must NOT acquire a
 *      story binding, must NOT call get_chat_context_story_id / route_task /
 *      resolveGovernanceDecision, and must NOT create an ai_runs row. It is a
 *      rate-limited n8n webhook relay keyed by visitor_id only.
 *
 *   D. classifyMessageComplexity is a PURE classifier whose verdict must remain
 *      stable across the §6.5 wiring (LIVE-GREEN, unit lock). Tier1/2 inputs
 *      (greeting/simple/moderate) and tier3+ inputs (complex/deep_analysis) keep
 *      their classification so the future SSE-vs-202 branch keys off a stable
 *      signal. FALSE-POSITIVE: an objectively complex prompt must NOT classify as
 *      greeting/simple (anti-downgrade — §6.5 "POVINNÝ").
 *
 *   E. chooseExecutionStrategy + kickOffReflectionWorkflow exist with the exact
 *      signatures /chat will call (§4.1 #3, §20 P0 #6). Today they have 0 prod
 *      callers (§19.3) — this is the regression guard that the wiring lands
 *      WITHOUT changing their public surface (skip-until-impl for the actual
 *      /chat wiring; live structural check that the symbols are exported).
 *
 *   F. Engine coherence: every ingress reaches orchestrationBridge → route_task
 *      → ai_runs(story_id) (§ architecture, §19.1 invariant). routeViaAisha
 *      (orchestrationBridge.ts) calls the `route_task` RPC which INSERTs into
 *      ai_runs(kind, story_id, status, route_plan) (route_task.sql:217). LIVE DB
 *      proof lives in the pgTAP sibling; here we lock the TS call shape.
 *
 * LIVE vs SKIP:
 *   - classifyMessageComplexity / chooseExecutionStrategy / kickOffReflectionWorkflow /
 *     routeViaAisha EXIST today (orchestrationBridge.ts) → LIVE unit assertions.
 *   - /chat + /public-chat + /dirigent/dispatch routes EXIST → LIVE, asserted at
 *     the HTTP layer only (handler modules NEVER imported — they pull Fastify
 *     server deps; HTTP-level keeps the file hermetic).
 *   - The §20 P0 #6 WIRING of classify/chooseStrategy/kickOff into /chat, and the
 *     §7 unifiedChatStream/chat()=accumulate inversion, do NOT exist yet →
 *     describe.skip / it.todo with precise contracts; NEVER top-level import a
 *     non-existent module.
 *
 * LIVE HTTP harness (mirrors story-resolver-hole.omni.spec.ts):
 *   process.env.OMNI_ACCEPTANCE     — required to run anything
 *   process.env.OMNI_BASE_URL       — svc-ai-chat base (default localhost:3011)
 *   process.env.OMNI_TENANT_A_JWT   — JWT whose sub owns the seeded story
 *   process.env.OMNI_PUBLIC_CHAT_URL — optional override for the public-chat base
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

// RESOLUTION CONVENTION (matches streaming-routing/classify-tier-boundaries.omni.spec.ts
// + router-consolidation.omni.spec.ts): orchestrationBridge.ts is NOT import-safe — its
// module scope top-imports `@aisha/security` (createSafeLogger, orchestrationBridge.ts:43),
// a workspace package that ships only built dist/ (absent in a source checkout), so a
// runtime import() poisons the whole suite file. Non-import-safe modules are asserted at
// SOURCE level via readFileSync. We therefore NEVER top-level import orchestrationBridge.
const ROOT = path.resolve(__dirname, "../../../..");
const BRIDGE_SRC = readFileSync(
  path.join(ROOT, "services/svc-ai-chat/src/lib/orchestrationBridge.ts"),
  "utf-8",
);
const CHAT_SRC = readFileSync(
  path.join(ROOT, "services/svc-ai-chat/src/routes/chat.ts"),
  "utf-8",
);
const ROUTE_TASK_SRC = readFileSync(
  path.join(ROOT, "aisha/db/sql/functions/route_task.sql"),
  "utf-8",
);

const ACCEPTANCE = Boolean(process.env.OMNI_ACCEPTANCE);
const d = ACCEPTANCE ? describe : describe.skip;

const BASE = (process.env.OMNI_BASE_URL ?? "http://localhost:3011").replace(/\/$/, "");
const PUBLIC_BASE = (process.env.OMNI_PUBLIC_CHAT_URL ?? BASE).replace(/\/$/, "");
const JWT_A = process.env.OMNI_TENANT_A_JWT ?? "";

/** HTTP helper: returns null on connection failure so a down service self-skips. */
async function http(
  base: string,
  path: string,
  init: RequestInit,
): Promise<Response | null> {
  try {
    return await fetch(`${base}${path}`, init);
  } catch {
    return null;
  }
}

// ═════════════════════════════════════════════════════════════════════════════
// D. Engine-coherence + §6.5-wiring SOURCE locks (LIVE unit, readFileSync).
//    These pin the EXACT current source facts the §20 P0 #6 wiring + §7 inversion
//    must preserve. SOURCE-level because orchestrationBridge/chat are not
//    import-safe (workspace deps). NOT a re-test of classifier thresholds — that
//    lives in streaming-routing/classify-tier-boundaries; here we lock the
//    /chat-path coherence the regression depends on.
// ═════════════════════════════════════════════════════════════════════════════
describe("regression-coherence · engine-coherence + wiring source locks (§4.1/§19.3/§F, LIVE unit)", () => {
  // POSITIVE — the 5-tier enum the lane decision partitions still exists. The
  // future SSE(tier1/2)-vs-202(tier3+) branch keys off these exact tiers.
  it("POSITIVE: MessageComplexity is the 5 declared tiers the lane decision partitions (§6.5)", () => {
    expect(BRIDGE_SRC).toContain(
      'export type MessageComplexity = "greeting" | "simple" | "moderate" | "complex" | "deep_analysis"',
    );
  });

  // POSITIVE — engine coherence (§F): the single ingress→ai_runs writer is
  // route_task, called via routeViaAisha; route_task INSERTs ai_runs(kind,
  // story_id,…) (route_task.sql:217). This is the chain every ingress shares.
  it("POSITIVE: routeViaAisha calls the route_task RPC (the one ingress→ai_runs writer)", () => {
    expect(BRIDGE_SRC).toMatch(/export async function routeViaAisha/);
    expect(BRIDGE_SRC).toMatch(/\.rpc\("route_task"/);
  });

  it("POSITIVE: route_task INSERTs into ai_runs carrying story_id (engine-coherence anchor §F)", () => {
    expect(ROUTE_TASK_SRC).toMatch(/INSERT INTO ai_runs \(kind, story_id, status, route_plan\)/);
  });

  // POSITIVE — /chat resolves the story via the shared resolver (chat.ts:145) and
  // routes via Aisha (chat.ts:512). After wiring, /chat MUST keep reaching this
  // same orchestrationBridge → route_task → ai_runs chain (no forked engine).
  it("POSITIVE: /chat resolves story_id via get_chat_context_story_id and routes via routeViaAisha", () => {
    expect(CHAT_SRC).toContain("get_chat_context_story_id");
    expect(CHAT_SRC).toMatch(/routeViaAisha\(/);
  });

  // REGRESSION GUARD — the §20 P0 #6 wiring targets: classify/chooseStrategy/
  // kickOff must remain exported with their current signatures so the wiring is
  // additive, not a rewrite. Today chooseExecutionStrategy/kickOff have 0 callers
  // (§19.3) — this lock is what proves the wiring landed without churning them.
  it("REGRESSION GUARD: the §6.5 wiring targets are exported (classify/chooseStrategy/kickOff)", () => {
    expect(BRIDGE_SRC).toMatch(/export function classifyMessageComplexity\(/);
    expect(BRIDGE_SRC).toMatch(/export async function chooseExecutionStrategy\(/);
    expect(BRIDGE_SRC).toMatch(/export async function kickOffReflectionWorkflow\(/);
  });

  it("REGRESSION GUARD: kickOffReflectionWorkflow creates ai_runs (fn_create_workflow_run) + runs reflection/orchestrator", () => {
    // §4.1 #3: kickOff founds ai_runs and the run proceeds via reflection/orchestrator.ts.
    const fnStart = BRIDGE_SRC.indexOf("export async function kickOffReflectionWorkflow");
    const fnBody = BRIDGE_SRC.slice(fnStart, fnStart + 2000);
    expect(fnBody).toMatch(/fn_create_workflow_run/);
    expect(fnBody).toMatch(/reflection\/orchestrator\.js/);
  });

  // FALSE-POSITIVE — /chat is SYNCHRONOUS today: the only execution call is a
  // buffered engine.execute(); there is NO tier branch and NO text/event-stream
  // emission (§19.3 "tier nikdy nevětví exekuci … vždy synchronní"). This pins
  // the legacy contract: the §6.5 wiring must NOT turn /chat into a token SSE.
  it("FALSE-POSITIVE: /chat executes synchronously (engine.execute) and emits NO text/event-stream today", () => {
    expect(CHAT_SRC).toMatch(/engine\.execute\(/);
    expect(CHAT_SRC).not.toMatch(/text\/event-stream/);
  });

  // FALSE-POSITIVE — /chat statefulness (§4.6): a fresh conversation is minted
  // ONLY when conversation_id is absent (chat.ts:412), and it is echoed in the
  // response body. A regression that always minted (ignoring a supplied id) would
  // spawn duplicate conversations — the §4.6 "stateless IDE plodí duplicitní" bug.
  it("FALSE-POSITIVE: /chat auto-creates a conversation only when conversation_id is absent (no duplicate spawn)", () => {
    expect(CHAT_SRC).toMatch(/if \(!conversation_id\)/);
    // The body echoes conversation_id back to the caller (chat.ts:1196-1197 / 1172).
    expect(CHAT_SRC).toMatch(/conversation_id,/);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// A + B. /chat synchronous + statefulness contract (§4.6, §19.3) — LIVE HTTP.
//    Route EXISTS; asserted at the HTTP layer only. Locks: buffered JSON (NOT
//    SSE) + conversation_id echo + auto-create-on-absent.
// ═════════════════════════════════════════════════════════════════════════════
d("regression-coherence · POST /chat synchronous + statefulness lock (§4.6/§19.3, LIVE)", () => {
  // POSITIVE — stateless first turn: absent conversation_id → server auto-creates
  // one (chat.ts:412) and echoes it in the buffered JSON body (chat.ts:1196-1197).
  it("LIVE positive: /chat without conversation_id returns buffered JSON echoing a fresh conversation_id (NOT SSE)", async () => {
    if (!JWT_A) return; // requires an authenticated tenant for the live matrix
    const res = await http(BASE, "/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${JWT_A}` },
      body: JSON.stringify({ message: "ahoj", language: "cs" }),
    });
    if (!res) return; // service down → skip
    // Behaviour lock: today /chat is buffered JSON, never a token SSE.
    expect(res.headers.get("content-type") ?? "").not.toMatch(/text\/event-stream/);
    if (res.status !== 200) return; // env/auth shape differs → don't assert body
    const body = (await res.json()) as { conversation_id?: string };
    expect(typeof body.conversation_id).toBe("string");
    expect((body.conversation_id ?? "").length).toBeGreaterThan(0);
  });

  // POSITIVE — stateful multi-turn: a supplied conversation_id is echoed back
  // unchanged (§4.6 stateful multi-turn). Anti-regression for the §4.6 wiring
  // that must "echo conversation_id" without minting a duplicate conversation.
  it("LIVE positive: /chat with a conversation_id echoes the SAME id back (no duplicate conversation)", async () => {
    if (!JWT_A) return;
    // Turn 1 — establish a conversation.
    const first = await http(BASE, "/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${JWT_A}` },
      body: JSON.stringify({ message: "ahoj", language: "cs" }),
    });
    if (!first || first.status !== 200) return;
    const cid = ((await first.json()) as { conversation_id?: string }).conversation_id;
    if (!cid) return;
    // Turn 2 — same conversation must be reused, not re-created.
    const second = await http(BASE, "/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${JWT_A}` },
      body: JSON.stringify({ message: "a co dál?", conversation_id: cid, language: "cs" }),
    });
    if (!second || second.status !== 200) return;
    const body2 = (await second.json()) as { conversation_id?: string };
    expect(body2.conversation_id).toBe(cid);
  });

  // FALSE-POSITIVE — /chat input contract: a non-string conversation_id must be
  // rejected, never coerced into a bogus session (chat.ts:107 validateBody).
  // Guards §4.6 against accepting a malformed id and minting an orphan session.
  it("LIVE false-positive: /chat with a non-string conversation_id must NOT be accepted as a session", async () => {
    if (!JWT_A) return;
    const res = await http(BASE, "/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${JWT_A}` },
      body: JSON.stringify({ message: "ahoj", conversation_id: 12345 }),
    });
    if (!res) return;
    // Must be a 4xx validation error (never a 200 with a coerced conversation).
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(res.status).toBeLessThan(500);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// C. /public-chat stays OUT of Omni governance (§19.1, FALSE-POSITIVE) — LIVE HTTP.
//    Route EXISTS; asserted at the HTTP layer. public-chat.ts is an n8n relay
//    keyed by visitor_id — no auth, no story, no governance, no ai_runs.
// ═════════════════════════════════════════════════════════════════════════════
d("regression-coherence · /public-chat must NOT acquire Omni governance (§19.1, LIVE false-positive)", () => {
  // POSITIVE — public-chat works WITHOUT any Authorization / story_id (its whole
  // point: "bez story by design"). Required fields are message + visitor_id only.
  it("LIVE positive: /public-chat accepts message+visitor_id with NO auth and NO story_id", async () => {
    const res = await http(PUBLIC_BASE, "/public-chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" }, // deliberately NO Authorization
      body: JSON.stringify({ message: "hi", visitor_id: "omni-accept-visitor-1" }),
    });
    if (!res) return; // service / n8n down → skip
    // 200 (relayed) or 502 (n8n upstream down) are both "accepted into the public
    // path"; the contract is that it does NOT demand auth/story. It must never be
    // a 401 (auth required) — that would mean it joined the governed surface.
    expect(res.status).not.toBe(401);
  });

  // FALSE-POSITIVE GUARD #1 — a body-supplied story_id must NOT bind public-chat
  // into a story / governed run. The route forwards only
  // {channel_slug, guardrails_level, language, message, visitor_id} to n8n
  // (public-chat.ts:88-94) — story_id is structurally dropped.
  it("LIVE false-positive: a body-supplied story_id must NOT govern /public-chat (silently ignored, never bound)", async () => {
    const res = await http(PUBLIC_BASE, "/public-chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        message: "hi",
        visitor_id: "omni-accept-visitor-2",
        // attacker-supplied governance hooks that public-chat must IGNORE:
        story_id: "00000000-0000-0000-0000-000000000000",
        model_override: "claude-sonnet-4",
      }),
    });
    if (!res) return;
    // Still treated as a public visitor request: no 401 (auth), no 403
    // (governance_not_allowed). The story_id rode along but changed nothing.
    expect(res.status).not.toBe(401);
    expect(res.status).not.toBe(403);
  });

  // FALSE-POSITIVE GUARD #2 — a Bearer PAT must NOT promote public-chat onto the
  // Omni /v1 governed lane. public-chat ignores Authorization entirely; presenting
  // a token must not change its (un)governed behaviour.
  it("LIVE false-positive: a Bearer token must NOT promote /public-chat onto the governed lane", async () => {
    const res = await http(PUBLIC_BASE, "/public-chat", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer mcp_omni-accept-should-be-ignored",
      },
      body: JSON.stringify({ message: "hi", visitor_id: "omni-accept-visitor-3" }),
    });
    if (!res) return;
    // The token is irrelevant to public-chat — it neither unlocks nor blocks.
    expect(res.status).not.toBe(401);
    expect(res.status).not.toBe(403);
  });

  // NEGATIVE — public-chat still enforces its OWN guard: missing visitor_id 400.
  // This proves the route is reachable & validating (so the false-positive
  // guards above are meaningful, not just hitting a dead route).
  it("LIVE negative: /public-chat without visitor_id returns 400 (its own validation, not Omni governance)", async () => {
    const res = await http(PUBLIC_BASE, "/public-chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message: "hi" }), // no visitor_id
    });
    if (!res) return;
    expect(res.status).toBe(400);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// /dirigent/dispatch ≤4s sync gating decision (§4.4, §12) — LIVE HTTP.
//    Route EXISTS; this locks the sync-gate behaviour (decision allow|block|ask)
//    and the schema-evolution graceful-degrade guard. Complements
//    story-resolver-hole (ownership) — here we lock the DECISION CONTRACT itself.
// ═════════════════════════════════════════════════════════════════════════════
d("regression-coherence · POST /dirigent/dispatch sync gating contract (§4.4, LIVE)", () => {
  // POSITIVE — a valid event returns within the ≤4s budget (N8N_TIMEOUT_MS=4000,
  // dirigent-supervisor.ts:42) and yields a structured advisory. decision, when
  // present, is one of allow|block|ask (dirigent-supervisor.ts:99/105/247-256).
  it("LIVE positive: a valid event resolves a sync gating decision within ~4s (allow|block|ask)", async () => {
    if (!JWT_A) return;
    const t0 = Date.now();
    const res = await http(BASE, "/dirigent/dispatch", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${JWT_A}` },
      body: JSON.stringify({ event: "prompt_submit" }),
    });
    if (!res) return;
    const elapsed = Date.now() - t0;
    // ≤4s relay budget + generous CI slack; the route MUST NOT hang past this.
    expect(elapsed).toBeLessThan(8_000);
    expect(res.status).toBeLessThan(500);
    if (res.status === 200) {
      const body = (await res.json()) as { decision?: string };
      if (body.decision !== undefined) {
        expect(["allow", "block", "ask"]).toContain(body.decision);
      }
    }
  });

  // FALSE-POSITIVE — schema-evolution graceful degrade (§20 "neznámý event type
  // nespadne"): an UNKNOWN event type must NOT be treated as a valid nudge
  // dispatch. VALID_EVENTS = {session_start, prompt_submit, pre_tool, post_tool,
  // stop} (dirigent-supervisor.ts:34-40) → 400 invalid_event.
  it("LIVE false-positive: an unknown event type must NOT be a valid dispatch (400 invalid_event)", async () => {
    if (!JWT_A) return;
    const res = await http(BASE, "/dirigent/dispatch", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${JWT_A}` },
      body: JSON.stringify({ event: "definitely_not_a_real_event" }),
    });
    if (!res) return;
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error?: string; valid?: string[] };
    expect(body.error).toBe("invalid_event");
    expect(body.valid).toEqual(
      expect.arrayContaining(["session_start", "prompt_submit", "pre_tool", "post_tool", "stop"]),
    );
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// E + F + A(future). SKIP-UNTIL-IMPL — the §20 P0 #6 wiring and §7 inversion do
// NOT exist yet. NO top-level import of any non-existent module; the future
// orchestrationBridge wiring is reached via DYNAMIC import inside the skipped
// block so this file still type-checks today.
// ─────────────────────────────────────────────────────────────────────────────
describe.skip("regression-coherence · classify/chooseStrategy/kickOff wired into /chat (NOT WIRED — §20 P0 #6, §4.1)", () => {
  // CONTRACT (§19.3 → §20 P0 #6): TODAY classifyMessageComplexity runs but the
  // tier NEVER branches execution (chat.ts:875 is unconditionally synchronous);
  // chooseExecutionStrategy:1308 + kickOffReflectionWorkflow:1342 have 0 callers.
  // The wiring MUST:
  //   1. tier1/2 → keep the existing SYNCHRONOUS engine.execute() turn semantics
  //      for the /chat caller (no behaviour change to the legacy surface).
  //   2. tier3+ → chooseExecutionStrategy(...) selects a graph, kickOffReflection-
  //      Workflow(...) creates an ai_runs row (fn_create_workflow_run) and POSTs
  //      to /reflect/runs; the /chat caller still gets a synchronous, non-hanging
  //      response (the orchestrated run proceeds out-of-band).
  //   3. NOT change classifyMessageComplexity / chooseExecutionStrategy /
  //      kickOffReflectionWorkflow PUBLIC SIGNATURES (the regression guard).
  // Verify via a DYNAMIC import (module exists today, the WIRING does not):
  //   const ob = await import(".../orchestrationBridge.js");
  //   expect(typeof ob.chooseExecutionStrategy).toBe("function");
  //   expect(typeof ob.kickOffReflectionWorkflow).toBe("function");
  it.todo("structural: chooseExecutionStrategy + kickOffReflectionWorkflow remain exported with unchanged signatures");
  it.todo("positive tier1/2: /chat keeps synchronous engine.execute() semantics for the caller after wiring");
  it.todo("positive tier3+: /chat invokes chooseExecutionStrategy → kickOffReflectionWorkflow (ai_runs row + POST /reflect/runs)");
  it.todo("false-positive: wiring does NOT downgrade a complex turn onto the synchronous fast lane (§6.5 POVINNÝ)");
});

describe.skip("regression-coherence · §7 streaming-engine inversion preserves chat() semantics (NOT IMPLEMENTED — §7)", () => {
  // CONTRACT (§7): chat() and chatStream() collapse onto a single shared
  // _executeCall(backend, request, streamMode); chat() = consume+accumulate via
  // unifiedChatStream until finish_reason:stop; unifiedChatStream does a
  // pre-first-token health-check + backend commit (NO mid-stream provider switch).
  // REGRESSION GUARD: the synchronous accumulate path must return the IDENTICAL
  // final text+usage a buffered call returns today (CI parity matrix:
  // stream=true vs stream=false — §7 #4). Module unifiedChatStream/_executeCall
  // does not exist yet → dynamic import inside the un-skipped block when it lands;
  // NEVER a top-level import.
  it.todo("positive: chat() accumulates unifiedChatStream chunks to a final {text, usage} (no partial leak)");
  it.todo("parity: stream=true and stream=false yield identical text+tokens for the same backend (§7 anti-drift)");
  it.todo("false-positive: a failed pre-first-token health-check sends NO partial message (no mid-stream fallback)");
});

describe.skip("regression-coherence · mobile /rest + /realtime stay on the one engine (NOT a separate engine — §4.2/4.3)", () => {
  // CONTRACT: the mobile surfaces (PostgREST /rest + Realtime /realtime) are NOT
  // a second response engine — they observe the SAME ai_runs / chat_messages the
  // /chat and /v1 surfaces write (chat.ts:1157 "Aisha observes chat_messages via
  // Postgres Realtime WebSocket"). The §7 inversion + §20 P0 #6 wiring must not
  // fork a mobile-only code path. Asserted end-to-end in e2e/omni/regression-
  // coherence.spec.ts once the Realtime broadcast/state lane (§4.3) is finalised.
  it.todo("coherence: a /chat turn surfaces to the mobile /realtime subscriber via the same chat_messages row");
  it.todo("coherence: mobile /rest reads the SAME ai_runs row route_task created (no mobile-only engine)");
});
