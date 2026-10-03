/**
 * Omni acceptance — governance-residency · detectDataSensitivity / on-prem gate (integration + unit)
 *
 * Contract source of truth: docs/planning/AISHA_OMNI_GATEWAY.md
 *   §11  "detectDataSensitivity(messages, ragContext) → {public|internal|confidential, tables[]}
 *         … při confidential tvrdě clow.allow_local=true + filtr cloud kandidátů
 *         (resolver allow_local už konzumuje). Klasifikace musí být rychlá
 *         (žádné těžké RLS joiny …) a Omni i warm evaluátor sdílí JEDEN verdikt …
 *         Audit do audit_journal. DoD #5."
 *   §1 #4 / §6 "aisha_resolve_clow_backend (baseline.sql:17681) … allow_local boost"
 *   §19.3 ledger row "Governance: resolveGovernanceDecision se volá (chat.ts) ale AŽ PO
 *         selectOptimalModel → nemůže ovlivnit cloud-vs-local; detectDataSensitivity
 *         neexistuje → residency nikdy neklasifikována (DoD #5 nesplněno)."
 *   §20 #9 "detectDataSensitivity PŘED selectOptimalModel → allow_local + filtr cloud (DoD #5)."
 *   §15 ledger "citlivé tabulky member_health_documents/dosing_logs/longevity_scores"
 *
 * Live-vs-skip policy for THIS area:
 *   - aisha_resolve_clow_backend EXISTS (baseline.sql:17681), the sensitive tables
 *     member_health_documents / dosing_logs / longevity_scores EXIST, and the
 *     resolveGovernanceDecision call site EXISTS in services/svc-ai-chat/src/routes/chat.ts
 *     → LIVE source/SQL assertions against the real symbols.
 *   - The ORDERING bug (resolveGovernanceDecision runs AFTER selectOptimalModel and
 *     therefore cannot influence cloud-vs-local) is a LIVE RED regression guard — it is
 *     EXPECTED TO FAIL today and goes green only when detectDataSensitivity runs BEFORE
 *     selectOptimalModel (§20 #9). Keep it RED.
 *   - The resolver's allow_local=true behaviour is BOOST-only, NOT a hard cloud filter
 *     (baseline.sql:17795-17796 `v_allow_local OR backend_kind NOT IN (local_*)`); the
 *     spec demands a hard filter at confidential. That mismatch is a LIVE RED guard too.
 *     NOTE (main-sync): orthogonal to merged-E0 admission — fn_admit_clow gates
 *     spend/runtime/capability/risk, NOT data sensitivity; residency is Phase-A scope.
 *   - detectDataSensitivity(), GovernanceDecision.canUseCloudApis / .dataSensitivity,
 *     unifiedChatStream, POST /v1/chat/completions do NOT exist yet → describe.skip /
 *     it.todo with a precise contract comment. NEVER top-level import a non-existent module.
 *
 * This file is run ONLY via vitest.omni-acceptance.config.ts and is excluded from the
 * default CI run (vitest.config.ts exclude: src/tests/omni-acceptance/**).
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

const REPO_ROOT = path.resolve(__dirname, "../../../..");
const CHAT_TS = path.join(REPO_ROOT, "services/svc-ai-chat/src/routes/chat.ts");
const GOVERNED_TS = path.join(
  REPO_ROOT,
  "services/svc-ai-chat/src/lib/governedOrchestration.ts",
);
const EVALUATE_TS = path.join(
  REPO_ROOT,
  "services/svc-ai-chat/src/routes/evaluate.ts",
);
const BASELINE_SQL = path.join(
  REPO_ROOT,
  "aisha/db/migrations/00000000000000_baseline.sql",
);

function read(file: string): string {
  return readFileSync(file, "utf8");
}

// ---------------------------------------------------------------------------
// LIVE substrate — the on-prem residency primitives the §11 gate must reuse.
// Proves the resolver + sensitive tables the spec anchors to really exist today
// with the exact identifiers detectDataSensitivity / the resolver consume.
// ---------------------------------------------------------------------------
describe("governance-residency · resolver + sensitive-table substrate (LIVE)", () => {
  const sql = read(BASELINE_SQL);

  it("POSITIVE: aisha_resolve_clow_backend exists with the (p_clow jsonb, p_context jsonb) signature (§1 #4, baseline:17681)", () => {
    expect(sql).toMatch(
      /CREATE OR REPLACE FUNCTION public\.aisha_resolve_clow_backend\(\s*p_clow jsonb,\s*p_context jsonb DEFAULT '\{\}'::jsonb\s*\)/,
    );
  });

  it("POSITIVE: the resolver reads allow_local from the clow and recognizes the local backend kinds (§6 allow_local boost)", () => {
    // allow_local is the override detectDataSensitivity must set hard=true at confidential.
    expect(sql).toMatch(
      /v_allow_local\s+boolean\s*:=\s*COALESCE\(\(p_clow->>'allow_local'\)::boolean,\s*true\)/,
    );
    // The backend kinds the on-prem gate must restrict to.
    expect(sql).toMatch(/'local_ollama',\s*--/);
    expect(sql).toMatch(/'local_vllm',\s*--/);
    // The cloud kinds confidential data must NOT reach.
    expect(sql).toMatch(/'direct_cloud',\s*--/);
    expect(sql).toMatch(/'llm_gateway',\s*--/);
  });

  it("POSITIVE: the three confidential anchor tables (§11/§15) exist in the live schema", () => {
    expect(sql).toMatch(/CREATE TABLE IF NOT EXISTS public\.longevity_scores \(/);
    expect(sql).toMatch(/CREATE TABLE IF NOT EXISTS dosing_logs \(/);
    expect(sql).toMatch(/CREATE TABLE IF NOT EXISTS member_health_documents \(/);
  });

  it("POSITIVE: audit_journal exists — the sink §11 'Audit do audit_journal' writes the verdict to", () => {
    expect(sql).toMatch(/audit_journal/);
  });
});

// ---------------------------------------------------------------------------
// LIVE RED GUARD #1 — the ordering bug (§19.3 ledger, §20 #9):
//   resolveGovernanceDecision is called in chat.ts AFTER selectOptimalModel, and it
//   takes the ALREADY-selected model as INPUT (selectedModel) — so it cannot move a
//   request from cloud to local. detectDataSensitivity must run BEFORE selectOptimalModel
//   so its verdict can set clow.allow_local before the backend is chosen.
//   EXPECTED TO FAIL today. Keep it RED.
// ---------------------------------------------------------------------------
describe("governance-residency · gate runs BEFORE model selection (LIVE RED regression guard)", () => {
  const chat = read(CHAT_TS);

  it("RED: a data-sensitivity verdict must be resolved BEFORE selectOptimalModel (§20 #9 — fails today)", () => {
    const selIdx = chat.indexOf("await selectOptimalModel(");
    const detIdx = chat.search(/detectDataSensitivity\s*\(/);
    expect(selIdx, "selectOptimalModel call must exist in chat.ts").toBeGreaterThan(-1);
    // EXPECTED RED: detectDataSensitivity is not called at all today (detIdx === -1),
    // and even resolveGovernanceDecision runs AFTER selectOptimalModel. This guard goes
    // green only when the §11 sensitivity verdict is computed before model selection.
    expect(
      detIdx > -1 && detIdx < selIdx,
      "detectDataSensitivity(...) must be called BEFORE selectOptimalModel(...) so its " +
        "confidential verdict can force clow.allow_local before the backend is chosen (§20 #9, DoD #5)",
    ).toBe(true);
  });

  it("FALSE-POSITIVE GUARD: documents WHY the RED test is correct — governance currently consumes the already-selected model", () => {
    // resolveGovernanceDecision receives selectedModel as an INPUT — it reacts to, it
    // does not drive, backend selection. And it sits AFTER selectOptimalModel in source.
    expect(chat).toMatch(/resolveGovernanceDecision\(\{/);
    expect(chat).toMatch(/selectedModel:\s*effectiveModel/);
    const selIdx = chat.indexOf("await selectOptimalModel(");
    const govIdx = chat.indexOf("resolveGovernanceDecision({");
    expect(selIdx).toBeGreaterThan(-1);
    expect(govIdx).toBeGreaterThan(selIdx);
  });
});

// ---------------------------------------------------------------------------
// LIVE RED GUARD #2 — the resolver's allow_local is BOOST-only, not a hard cloud filter.
//   §11 requires "při confidential tvrdě clow.allow_local=true + filtr cloud kandidátů".
//   But baseline.sql:17795-17796 is `(v_allow_local OR backend_kind NOT IN (local_*))`:
//   when allow_local=true this predicate is TRUE for cloud rows too, so a high-bench
//   cloud model can still be the top candidate. allow_local only adds a +0.20 score
//   boost to local (17767), it does NOT exclude cloud. So allow_local=true alone does
//   NOT guarantee on-prem residency. EXPECTED TO FAIL today. Keep it RED.
//   NOTE (main-sync): Phase-A residency gap, NOT an E0 regression — merged
//   fn_admit_clow (baseline.sql:31035) is orthogonal (no data-sensitivity axis).
//   Target hard-filter shape: the sibling fn at baseline.sql:17335.
// ---------------------------------------------------------------------------
describe("governance-residency · resolver hard-filters cloud at confidential (LIVE RED regression guard)", () => {
  const sql = read(BASELINE_SQL);

  it("§11 cloud hard-filter: a confidential request (clow.cloud_forbidden) EXCLUDES direct_cloud/llm_gateway, not merely boosts local", () => {
    // RECONCILED (2026-06-21, E-Omni step 5): the ORIGINAL form of this RED guard
    // asserted the local-opt-out predicate `AND (v_allow_local OR backend_kind NOT IN
    // (local_*))` had been REMOVED. But the discovery spec (discovery-base-instance §6
    // "allow_local=false MUST FILTER OUT local backends") REQUIRES that exact predicate
    // to remain. The two are ORTHOGONAL filters: allow_local gates LOCAL eligibility;
    // §11 residency gates CLOUD eligibility. The correct fix ADDS a cloud hard-filter
    // (clow.cloud_forbidden ⇒ exclude direct_cloud/llm_gateway) ALONGSIDE the untouched
    // local opt-out — it does not delete it. So this guard now asserts the §11 INTENT
    // directly: the cloud hard-filter predicate is present in the baseline resolver.
    // Expressed as a POSITIVE local-allow ("when cloud_forbidden, ONLY on-prem is
    // eligible") rather than a `NOT IN (…llm_gateway)` blacklist — the latter would
    // violate the llm-gateway resolver-contract gates (gateway must never be
    // blacklisted in the WHERE). The positive form is semantically identical for
    // confidential (cloud reaches ZERO invocations) but keeps the gateway a peer
    // when cloud IS permitted.
    const hasCloudHardFilter =
      /NOT\s+v_cloud_forbidden\s+OR\s+p\.backend_kind\s+IN\s*\(\s*'local_ollama'\s*,\s*'local_vllm'\s*\)/.test(
        sql,
      );
    expect(
      hasCloudHardFilter,
      "aisha_resolve_clow_backend must HARD-EXCLUDE cloud when clow.cloud_forbidden=true " +
        "(confidential) by allowing ONLY local_ollama/local_vllm — so a high-bench cloud " +
        "model can never win for confidential data (§11 DoD #5); confidential reaches ZERO " +
        "cloud backend. (Positive local-allow, NOT a gateway blacklist — see llm-gateway gates.)",
    ).toBe(true);
  });

  it("FALSE-POSITIVE GUARD: confirm allow_local today is implemented ONLY as a +0.20 score boost (documents the gap)", () => {
    // The +0.20 local bonus exists …
    expect(sql).toMatch(
      /CASE WHEN p\.backend_kind IN \('local_ollama','local_vllm'\) AND v_allow_local THEN 0\.20 ELSE 0\.0 END/,
    );
    // … but there is NO predicate excluding direct_cloud/llm_gateway when allow_local=true.
    // (If one is ever added, this guard will need updating alongside RED guard #2 flipping green.)
    const excludesCloudWhenLocal =
      /v_allow_local[\s\S]{0,80}backend_kind\s+NOT IN \('direct_cloud',\s*'llm_gateway'\)/.test(
        sql,
      );
    expect(excludesCloudWhenLocal).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// LIVE RED GUARD #3 — forked residency: Omni chat path and warm evaluator do NOT share
//   one verdict. §11 "Omni i warm evaluátor sdílí JEDEN verdikt (jinak fork residency)".
//   Today: chat.ts goes through selectOptimalModel + resolveGovernanceDecision (governed),
//   while evaluate.ts (warm evaluator) has NO sensitivity/governance gate at all — neither
//   references detectDataSensitivity. (Router-independent: evaluate.ts now dispatches via the
//   canonical llmRouter after router-consolidation, but still has no residency gate.) EXPECTED RED.
// ---------------------------------------------------------------------------
describe("governance-residency · Omni and warm evaluator share ONE verdict (LIVE RED regression guard)", () => {
  const evaluate = read(EVALUATE_TS);
  const chat = read(CHAT_TS);

  it("RED: the warm evaluator (evaluate.ts) must consult the SAME detectDataSensitivity verdict (§11 — fails today)", () => {
    const evalUsesVerdict = /detectDataSensitivity\s*\(/.test(evaluate);
    // EXPECTED RED: evaluate.ts has no sensitivity gate; it dispatches via unifiedChat
    // (kebab router) directly. Goes green only when both surfaces funnel through one verdict.
    expect(
      evalUsesVerdict,
      "warm evaluator (services/svc-ai-chat/src/routes/evaluate.ts) must call detectDataSensitivity " +
        "so confidential eval inputs cannot leak to cloud while the chat path forbids it (§11 single verdict)",
    ).toBe(true);
  });

  it("FALSE-POSITIVE GUARD: the fork is closed via the SHARED residency verdict, not by duplicating full governance into the evaluator", () => {
    // Post-fix corrected state (§11 single verdict achieved): evaluate.ts (warm
    // evaluator) now consults the SAME detectDataSensitivity verdict as the chat path
    // — the residency fork is closed. But it remains a warm evaluator: it does NOT
    // carry the full resolveGovernanceDecision path (that stays chat-only). One shared
    // RESIDENCY verdict, NOT a duplicated governance engine. (The spec's sibling guard
    // #2 Test B documents the same "flips green when the fix lands" expectation.)
    expect(chat).toMatch(/resolveGovernanceDecision/);
    expect(evaluate).not.toMatch(/resolveGovernanceDecision/);
    expect(evaluate).toMatch(/detectDataSensitivity/);
  });
});

// ---------------------------------------------------------------------------
// SKIP-UNTIL-IMPL — detectDataSensitivity() unit + integration contract.
// detectDataSensitivity does NOT exist (grep over services/src = zero non-test hits),
// GovernanceDecision has no canUseCloudApis/dataSensitivity field, and unifiedChatStream
// + POST /v1/chat/completions are unbuilt. Contract-only; NEVER top-level import the
// missing module — when it lands, replace it.todo with a dynamic import inside the test.
// ---------------------------------------------------------------------------
describe.skip("governance-residency · detectDataSensitivity() (SKIP until §11 / §19.3 lands)", () => {
  // Expected module (when built): services/svc-ai-chat/src/lib/governedOrchestration.ts
  //   export function detectDataSensitivity(
  //     messages: { role: string; content: string }[],
  //     ragContext: { tables?: string[]; provenance?: unknown } | null,
  //   ): { sensitivity: "public" | "internal" | "confidential"; tables: string[] }
  // Verdict feeds GovernanceDecision { dataSensitivity, canUseCloudApis } and is the SOLE
  // setter of clow.allow_local before aisha_resolve_clow_backend is called.

  it.todo(
    "POSITIVE (public): a prompt with no sensitive-table provenance and no RAG anchor → " +
      "{sensitivity:'public', tables:[]}, canUseCloudApis=true. clow.allow_local is NOT forced, " +
      "so aisha_resolve_clow_backend may pick a cloud backend (direct_cloud/llm_gateway).",
  );

  it.todo(
    "POSITIVE (internal): a prompt referencing non-confidential business context classifies " +
      "'internal' — cloud still permitted (canUseCloudApis=true) but flagged for audit.",
  );

  it.todo(
    "POSITIVE (confidential): a prompt/ragContext referencing member_health_documents, dosing_logs, " +
      "or longevity_scores → {sensitivity:'confidential', tables:[...]} and hard clow.allow_local=true, " +
      "canUseCloudApis=false (§11 'confidential tvrdě allow_local=true').",
  );

  it.todo(
    "PERF: detectDataSensitivity completes < 100ms and performs NO heavy RLS joins — table/provenance " +
      "matching only (§11 'Klasifikace musí být rychlá, žádné těžké RLS joiny'). The verdict is cached " +
      "per conversation_id so it is computed once, not re-scanned per turn.",
  );

  it.todo(
    "AUDIT: every detectDataSensitivity verdict is written to audit_journal with user_id, timestamp, " +
      "sensitivity classification, and the matched table list (§11 'Audit do audit_journal', DoD #5).",
  );
});

// ---------------------------------------------------------------------------
// SKIP-UNTIL-IMPL — the FALSE-POSITIVE residency guard at the resolver/dispatch seam.
// This is the crucial guard: confidential data must produce ZERO cloud-backend
// invocations even at the most expensive tier. It requires (a) detectDataSensitivity,
// (b) the resolver hard-filter (RED guard #2 above), and (c) a backend-invocation
// recorder around the InferenceBackend dispatch — none of which exist yet. Contract only.
// ---------------------------------------------------------------------------
describe.skip("governance-residency · confidential → ZERO cloud invocation (SKIP until §11 enforcement lands)", () => {
  // When built, this test wraps the InferenceBackend dispatch with the shared
  // backend-recorder helper (under src/tests/omni-acceptance/_helpers) and asserts on the
  // set of backend_kind values actually invoked for one confidential request at tier complex.

  it.todo(
    "FALSE-POSITIVE GUARD (the crucial one): a confidential prompt (references member_health_documents/" +
      "dosing_logs/longevity_scores) routed at tier 'complex' results in ZERO cloud-backend invocations — " +
      "the backend-recorder shows ONLY backend_kind in {local_ollama, local_vllm}; NEVER direct_cloud or " +
      "llm_gateway — even though the tier would normally prefer a cloud model (§11 DoD #5, §20 'confidential→žádný cloud call').",
  );

  it.todo(
    "POSITIVE: a public prompt at tier 'complex' DOES allow a cloud backend — the backend-recorder may show " +
      "direct_cloud/llm_gateway (residency must not lock out cloud for non-sensitive data; isolation ≠ lockout).",
  );

  it.todo(
    "NEGATIVE (fail-closed): a confidential prompt when ONLY cloud backends are healthy (no local_ollama/" +
      "local_vllm available) must FAIL CLOSED — the resolver returns resolved=false / the request returns 403 " +
      "governance_not_allowed (§5.6). It must NOT silently fall back to a cloud backend. Zero cloud invocation " +
      "recorded; no SSE chunk emitted.",
  );

  it.todo(
    "FALSE-POSITIVE GUARD: a body-supplied clow.allow_local=false on a CONFIDENTIAL request must NOT override " +
      "the governance verdict — the gate's allow_local=true wins (client cannot opt sensitive data into cloud). " +
      "Backend-recorder shows zero cloud invocation.",
  );

  it.todo(
    "FALSE-POSITIVE GUARD: env having OPENAI_API_KEY / ANTHROPIC_API_KEY set (cloud 'available') must NOT cause " +
      "a confidential request to use cloud — availability of a cloud key is orthogonal to the residency verdict " +
      "(§11 DoD #5). Recorder shows only local backends invoked.",
  );

  it.todo(
    "SINGLE VERDICT: the warm evaluator (POST /evaluate) and Omni (POST /v1/chat/completions) given the SAME " +
      "confidential input produce the SAME residency verdict — neither uses cloud where the other forbids it " +
      "(§11 'Omni i warm evaluátor sdílí JEDEN verdikt', no fork residency).",
  );
});
