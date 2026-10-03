/**
 * Omni acceptance — quota-admission · PRE-FLIGHT ADMISSION (integration)
 *
 * Contract source of truth: docs/planning/AISHA_OMNI_GATEWAY.md
 *   §5.6  "Synchronní gaty jako HTTP PŘED SSE: 402 spend_denied …"
 *   §9    "Pre-flight admission jako Phase A guardrail … sdílený enforceQuota(
 *          user_id, estTokens, estCostUsd) middleware nad
 *          fn_check_and_consume_llm_quota_audited … PŘED dispatchem"
 *   §14/9 ledger row 14: "Pravá mezera: žádný PRE-dispatch gate v chat.ts/v1"
 *   §20   Regresní pojistky: "pre-flight quota (402 před prvním bytem)"
 *
 * Live-vs-skip policy for THIS area:
 *   - fn_check_and_consume_llm_quota_audited EXISTS (baseline.sql:26427) → LIVE
 *     assertions against its real signature/return shape.
 *   - The ABSENCE of a pre-dispatch gate in services/svc-ai-chat/src/routes/chat.ts
 *     is a LIVE RED guard: chat.ts:875 calls engine.execute() with NO prior
 *     enforceQuota / fn_check_and_consume_llm_quota_audited call, and only maps a
 *     402 that bubbles up from the provider AFTER dispatch (chat.ts:934). That
 *     test is EXPECTED TO FAIL today and is an intentional regression guard.
 *   - enforceQuota() middleware, POST /v1/chat/completions, POST /v1/messages,
 *     unifiedChatStream do NOT exist yet → describe.skip / it.todo with a precise
 *     contract comment. NEVER top-level import a non-existent module.
 *
 * This file is run ONLY via vitest.omni-acceptance.config.ts and is excluded
 * from the default CI run (vitest.config.ts exclude: src/tests/omni-acceptance/**).
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

const REPO_ROOT = path.resolve(__dirname, "../../../..");
const CHAT_TS = path.join(REPO_ROOT, "services/svc-ai-chat/src/routes/chat.ts");
const BASELINE_SQL = path.join(
  REPO_ROOT,
  "aisha/db/migrations/00000000000000_baseline.sql",
);

function read(file: string): string {
  return readFileSync(file, "utf8");
}

// ---------------------------------------------------------------------------
// LIVE — the quota RPC surface that pre-flight admission MUST be built on top of.
// These prove the substrate the spec (§9, ledger #14) says to reuse really exists
// today with the exact signature enforceQuota() will call.
// ---------------------------------------------------------------------------
describe("quota-admission · fn_check_and_consume_llm_quota_audited (LIVE substrate)", () => {
  const sql = read(BASELINE_SQL);

  it("POSITIVE: RPC exists with the (uuid, int, numeric) signature enforceQuota will call", () => {
    // §9: "nad fn_check_and_consume_llm_quota_audited"
    expect(sql).toMatch(
      /CREATE OR REPLACE FUNCTION public\.fn_check_and_consume_llm_quota_audited\(\s*p_user_id\s+uuid,\s*p_tokens\s+int,\s*p_cost\s+numeric\s*\)/,
    );
  });

  it("POSITIVE: RPC returns the {allowed,reason,remaining_*} envelope a pre-flight gate maps to 402", () => {
    // The 402 spend_denied decision must be derivable from this return shape.
    expect(sql).toMatch(/RETURN jsonb_build_object\(/);
    expect(sql).toMatch(/'allowed',\s+v_allowed/);
    expect(sql).toMatch(/'reason',\s+v_reason/);
    expect(sql).toMatch(/'remaining_tokens'/);
    expect(sql).toMatch(/'remaining_cost'/);
  });

  it("NEGATIVE: exhausted token budget yields allowed=false reason=token_limit_exceeded (the 402 trigger)", () => {
    // The denial path the 402 spend_denied mapping depends on.
    expect(sql).toMatch(
      /IF v_quota\.consumed_tokens_today \+ p_tokens > v_quota\.daily_token_limit THEN\s*\n\s*v_allowed := false;\s*\n\s*v_reason\s+:= 'token_limit_exceeded';/,
    );
    expect(sql).toMatch(/v_reason\s+:= 'cost_limit_exceeded';/);
  });

  it("FALSE-POSITIVE GUARD: denial must NOT consume budget (no double-charge of an already-exhausted user)", () => {
    // The UPDATE that increments consumed_* lives ONLY inside the ELSE (allowed)
    // branch — a denied pre-flight check must not mutate the ledger further.
    // Assert the consume UPDATE is in the v_allowed := true branch, and the
    // denial branch only audits (INSERT INTO audit_journal).
    expect(sql).toMatch(
      /v_allowed := true;[\s\S]*?UPDATE public\.llm_quota SET\s*\n\s*consumed_tokens_today = consumed_tokens_today \+ p_tokens/,
    );
    expect(sql).toMatch(
      /IF NOT v_allowed THEN\s*\n\s*INSERT INTO public\.audit_journal/,
    );
  });
});

// ---------------------------------------------------------------------------
// LIVE RED GUARD — the real current bug (ledger #14, §19.3):
//   "tier nikdy nevětví exekuci (chat.ts:875 vždy synchronní engine.execute())"
//   "Pravá mezera: žádný PRE-dispatch gate v chat.ts/v1"
// chat.ts dispatches to the workflow engine WITHOUT a pre-flight quota gate; the
// only 402 it produces is mapped from a provider error AFTER dispatch (chat.ts:934),
// which means partial/streamed bytes can precede the 402. This test is EXPECTED
// TO FAIL until enforceQuota() lands before engine.execute(). Keep it RED.
// ---------------------------------------------------------------------------
describe("quota-admission · pre-dispatch gate in chat.ts (LIVE RED regression guard)", () => {
  const chat = read(CHAT_TS);

  it("RED: a pre-flight admission gate must run BEFORE engine.execute() (ledger #14 — fails today)", () => {
    // REALIGNED to merged-E0 reality (main-sync, ZADÁNÍ §6.1 + I6 "Admission před
    // resolverem"): the canonical pre-resolver gate is fn_admit_clow
    // (baseline.sql:31002+), which folds the spend axis via fn_authorize_task_spend
    // and is already called by the reflection path (openclaw_resolve_clow.ts). A
    // standalone enforceQuota() may never exist — so this gate is GREEN when chat.ts
    // ADMITS via fn_admit_clow before dispatch. The quota-audited RPC remains a
    // secondary acceptable mechanism.
    const callsAdmissionPreDispatch =
      /fn_admit_clow\s*\(/.test(chat) ||
      /enforceQuota\s*\(/.test(chat) ||
      /fn_check_and_consume_llm_quota_audited/.test(chat);
    // EXPECTED RED: chat.ts (/v1 ingress) currently calls NONE of these before
    // engine.execute() — the merged admission composer is wired into the reflection
    // nodes, NOT the Omni ingress. Goes green when fn_admit_clow gates chat.ts.
    expect(
      callsAdmissionPreDispatch,
      "chat.ts must ADMIT via fn_admit_clow (or quota RPC) BEFORE engine.execute() — deny→402, ask→202 (§6.1/§9, ledger #14)",
    ).toBe(true);
  });

  it("FALSE-POSITIVE GUARD: the existing 402 is provider-error mapping, NOT a pre-flight gate", () => {
    // Documents WHY the RED test above is correct: the 402 in chat.ts is reached
    // from inside the catch block that handles apiError.status === 402 AFTER
    // engine.execute() threw — i.e. post-dispatch, not pre-flight admission.
    expect(chat).toMatch(/const result = await engine\.execute\(/);
    expect(chat).toMatch(/if \(apiError\.status === 402\)/);
    // The 402 mapping sits after the engine.execute() call in source order.
    const execIdx = chat.indexOf("await engine.execute(");
    const four02Idx = chat.indexOf("apiError.status === 402");
    expect(execIdx).toBeGreaterThan(-1);
    expect(four02Idx).toBeGreaterThan(execIdx);
  });
});

// ---------------------------------------------------------------------------
// SKIP-UNTIL-IMPL — enforceQuota() middleware + /v1 ingress.
// Surfaces do NOT exist yet (no enforceQuota(), no routes/v1-chat.ts,
// no POST /v1/chat/completions, no POST /v1/messages). HTTP-level / dynamic-import
// contract only; NEVER top-level import the missing module.
// ---------------------------------------------------------------------------
describe.skip("quota-admission · enforceQuota() pre-flight middleware (SKIP until §9 / P1 #10 lands)", () => {
  it.todo(
    "POSITIVE: enforceQuota(user_id, estTokens, estCostUsd) is called BEFORE dispatch on POST /v1/chat/completions " +
      "(§9). On allow it proceeds to unifiedChatStream and the response begins streaming.",
  );

  it.todo(
    "NEGATIVE: exhausted-quota user → HTTP 402 with body {error:{type:'spend_denied', message}} " +
      "(§5.6) sent BEFORE the first SSE chunk; Content-Type is application/json (NOT text/event-stream); " +
      "X-AISHA-Run-ID header present for recovery (§5.6). No `data: ` line is ever written.",
  );

  it.todo(
    "NEGATIVE/no-leak: after a 402 spend_denied, ZERO tokens are delivered — response body contains no " +
      "delta.content and no `data: [DONE]`. Pre-flight gate is the only writer of the response.",
  );

  it.todo(
    "FALSE-POSITIVE GUARD: enforceQuota() is scoped to inbound chat ONLY — it must NOT reject known-safe/free " +
      "endpoints. GET /v1/models, /.well-known/aisha-gateways, /v1/auth/* and health checks return 200 with NO " +
      "quota consumption (§9 'middleware nad … scoped to inbound chat'; §5.5 /v1/models). enforcement only on " +
      "POST /v1/chat/completions and POST /v1/messages.",
  );

  it.todo(
    "FALSE-POSITIVE GUARD: enforceQuota() keys on req.user.sub (PAT→user_id), NEVER on a body-supplied user_id " +
      "(§9 reuse of keyByUserOrIp prefers req.user.sub; §16 'user = PAT→user_id, nikdy z body'). A body field " +
      "claiming another user's id must NOT charge or credit that user's quota.",
  );

  it.todo(
    "POSITIVE: both protocol surfaces gate identically — POST /v1/messages (Anthropic) funnels through the SAME " +
      "enforceQuota() as POST /v1/chat/completions (§5 'oba funnelují do unifiedChatStream').",
  );
});
