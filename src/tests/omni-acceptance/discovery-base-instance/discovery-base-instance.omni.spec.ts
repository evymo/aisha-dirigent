/**
 * AISHA Omni — Acceptance: Model discovery (env-driven "uses what it has") + base-vs-instance
 * Area: discovery-base-instance  ·  Kinds: unit + integration + (HTTP-contract skip-until-impl)
 * Spec source of truth: docs/planning/AISHA_OMNI_GATEWAY.md (v4)
 *   §5.5  Identita modelu & discovery — rodina aisha-* tierů + /v1/models + cost/latency metadata
 *   §6    Model cascade — tier maps + getFallbackModelTiers + aisha_resolve_clow_backend (allow_local boost)
 *   §11   Governance on-prem gate — confidential ⇒ clow.allow_local=true + filtr cloud kandidátů
 *   §15   registry seed rodiny aisha-* v ai_provider_registry
 *   §19.3 Model discovery: /models/list admin-only; aisha_resolve_clow_backend SECURITY DEFINER bypassuje RLS
 *   §19.4 Báze env-driven (factory→null když unset); AISHA_EXECUTION_MODE local|hybrid|cloud;
 *         tier fallback env→DB(get_adaptive_model_tiers)→default; GAP: per-instance registry RLS nevynutitelná;
 *         INSTANCE customizuje JEN přes env/DB-seed/fork-folder — NESMÍ přidat tenant kód do routing/gateway/governance
 *   §20   P1 #12 registry RLS + veřejné GET /v1/models; regrese: per-instance model isolation
 *
 * ISOLATION (per suite convention):
 *  - Lives under src/tests/omni-acceptance/**\/*.omni.spec.ts; runs ONLY via vitest.omni-acceptance.config.ts
 *    (mirrors vitest.gates.config.ts). The default vitest.config.ts already EXCLUDES src/tests/omni-acceptance/**.
 *  - Belt-and-suspenders: the whole suite self-skips unless process.env.OMNI_ACCEPTANCE is set, so even a stray
 *    normal CI run can never break on the intentionally-RED guards below.
 *
 * LIVE vs SKIP applied here:
 *  - getExecutionMode() (executionMode.ts) EXISTS and is dependency-free → imported LIVE.
 *  - Provider factories (createOpenAIBackend/…/createVLLMBackend) + orchestrationBridge tier maps EXIST but
 *    transitively import the @aisha/security workspace package, which the shared omni vitest config does NOT
 *    alias (and which I must not edit). Per the rule "never top-level import a non-existent/unresolvable module",
 *    those LIVE assertions are SOURCE-LEVEL (read the real file, assert the documented guard) — the same
 *    pg_get_functiondef-style source inspection the sibling pat-tenancy spec uses for DB functions — PLUS a
 *    self-contained behavioral replica of the documented factory contract for positive/negative/false-positive.
 *  - GET /v1/models, POST /v1/chat/completions DO NOT EXIST yet (§19 "Omni /v1 v kódu NEEXISTUJE") →
 *    describe.skip / it.todo with precise contract comments; HTTP-level only, no module import.
 *
 * SHARED SCAFFOLD (read-only, do NOT edit/recreate): when src/tests/omni-acceptance/_helpers + _fixtures land,
 *  the LIVE DB block should consume the shared pg-client helper instead of the local bootstrap below.
 */
import { describe, it, expect, beforeAll } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

// executionMode.ts has NO workspace-package imports → safe to import LIVE under the node omni config.
// Extracted to @aisha/llm-dispatch (git mv); still dependency-free, still imported by source path.
import { getExecutionMode } from "../../../../packages/llm-dispatch/src/executionMode.ts";

const ACCEPTANCE = Boolean(process.env.OMNI_ACCEPTANCE);
const d = ACCEPTANCE ? describe : describe.skip;

// Repo-rooted absolute paths to the REAL source files (grounding for source-level LIVE assertions).
// vitest cwd is the repo root (where vitest.omni-acceptance.config.ts lives).
const SVC = "services/svc-ai-chat/src";
// Per-provider backends + executionMode were extracted to @aisha/llm-dispatch (git mv).
const DISPATCH = "packages/llm-dispatch/src";
const FILE = {
  executionMode: resolve(process.cwd(), `${DISPATCH}/executionMode.ts`),
  openai: resolve(process.cwd(), `${DISPATCH}/providers/openai.ts`),
  anthropic: resolve(process.cwd(), `${DISPATCH}/providers/anthropic.ts`),
  gemini: resolve(process.cwd(), `${DISPATCH}/providers/gemini.ts`),
  openaiCompat: resolve(process.cwd(), `${DISPATCH}/providers/openai-compat.ts`),
  orchestrationBridge: resolve(process.cwd(), `${SVC}/lib/orchestrationBridge.ts`),
} as const;

function src(file: string): string {
  return readFileSync(file, "utf-8");
}

// Real identifiers grounded in code/spec (NO invented symbols):
//   factory  createOpenAIBackend()   openai.ts:234        env OPENAI_API_KEY        → null when unset
//   factory  createAnthropicBackend() anthropic.ts:199    env ANTHROPIC_API_KEY     → null when unset
//   factory  createGeminiBackend()   gemini.ts:218        env GOOGLE_AI_API_KEY      → null when unset
//   factory  createOllamaBackend()   openai-compat.ts:312 env OLLAMA_URL             → null when unset
//   factory  createVLLMBackend()     openai-compat.ts:344 env VLLM_GENERATION_URL    → null when unset
//   factory  createGatewayBackend()  openai-compat.ts:379 env AISHA_LLM_GATEWAY_URL + _KEY → null when either unset
//   enum     ExecutionMode = "local" | "hybrid" | "cloud"  executionMode.ts:16  (default "cloud")
//   tiers    getCloudModelTiers (MODEL_TIER_*) / getLocalModelTiers (MODEL_LOCAL_*) orchestrationBridge.ts:1096,1110
//   chain    selectOptimalModel → resolveModelTiersFromRegistry → rpc("get_adaptive_model_tiers") → getFallbackModelTiers
//   resolver public.aisha_resolve_clow_backend(jsonb,jsonb) baseline.sql:17681 (SECURITY DEFINER, allow_local boost)
//   table    public.ai_provider_registry baseline.sql:2281  (RLS read = auth.uid() IS NOT NULL — no tenant filter)
//   table    public.ai_model_registry    baseline.sql:2158  (input_price_per_m/output_price_per_m cost cols)

// ─────────────────────────────────────────────────────────────────────────────
// Optional LIVE DB harness (mirrors sibling specs). Self-skips unless a DB URL is
// provided AND `pg` loads. Replace with the shared pg-client helper once it lands.
// ─────────────────────────────────────────────────────────────────────────────
const DB_URL = process.env.AISHA_DB_URL || process.env.DATABASE_URL || "";
type QueryFn = (sql: string, params?: unknown[]) => Promise<{ rows: Array<Record<string, unknown>> }>;
let query: QueryFn | null = null;

beforeAll(async () => {
  if (!ACCEPTANCE || !DB_URL) return;
  try {
    const pgMod = (await import("pg")) as unknown as {
      Pool: new (cfg: { connectionString: string }) => {
        query: (sql: string, params?: unknown[]) => Promise<{ rows: Array<Record<string, unknown>> }>;
      };
    };
    const pool = new pgMod.Pool({ connectionString: DB_URL });
    query = (sql, params) => pool.query(sql, params);
  } catch {
    query = null;
  }
});

function requireDb(): QueryFn {
  if (!query) throw new Error("__SKIP_NO_DB__");
  return query;
}

// ═════════════════════════════════════════════════════════════════════════════
// 1. AISHA_EXECUTION_MODE gating  (§19.4)  — unit, LIVE (real import)
//    "AISHA_EXECUTION_MODE (local|hybrid|cloud) gatuje" + default cloud.
//    positive: present→parsed; negative: absent→cloud default; false-positive: junk MUST NOT be honored.
// ═════════════════════════════════════════════════════════════════════════════
d("discovery · AISHA_EXECUTION_MODE gating (§19.4, LIVE)", () => {
  const KEY = "AISHA_EXECUTION_MODE";
  let saved: string | undefined;
  beforeAll(() => { saved = process.env[KEY]; });
  // restore after each via try/finally inside tests (no afterEach to keep deps minimal)

  function withMode<T>(value: string | undefined, fn: () => T): T {
    const prev = process.env[KEY];
    try {
      if (value === undefined) delete process.env[KEY];
      else process.env[KEY] = value;
      return fn();
    } finally {
      if (prev === undefined) delete process.env[KEY];
      else process.env[KEY] = prev;
    }
  }

  it("positive: local|hybrid are honored verbatim (case/space-insensitive)", () => {
    expect(withMode("local", getExecutionMode)).toBe("local");
    expect(withMode("hybrid", getExecutionMode)).toBe("hybrid");
    expect(withMode("  HYBRID ", getExecutionMode)).toBe("hybrid"); // toLowerCase().trim()
  });

  it("negative: unset env → default 'cloud' (backward compat, executionMode.ts:22)", () => {
    expect(withMode(undefined, getExecutionMode)).toBe("cloud");
  });

  it("false-positive guard: an unknown mode MUST NOT be treated as a valid mode → falls back to cloud", () => {
    // The system must not silently honor a bogus mode (e.g. typo 'loca', 'on-prem', 'gpu') as local.
    expect(withMode("loca", getExecutionMode)).toBe("cloud");
    expect(withMode("on-prem", getExecutionMode)).toBe("cloud");
    expect(withMode("local; rm -rf", getExecutionMode)).not.toBe("local");
  });

  void saved;
});

// ═════════════════════════════════════════════════════════════════════════════
// 2. Provider factory env-driven availability  (§19.4 "uses what it has")  — unit
//    Each create*Backend() returns null when its key/URL env is unset, a backend when set.
//    LIVE here is SOURCE-LEVEL (the factory module transitively imports @aisha/security which the
//    shared omni config can't resolve — see header). We (a) assert the real guard exists in the real
//    file and (b) exercise the documented contract via a behavioral replica for full polarity.
// ═════════════════════════════════════════════════════════════════════════════
d("discovery · provider factory env→null contract (§19.4, LIVE source + behavioral)", () => {
  // (a) LIVE source-level: the documented `if (!<env>) return null` guard is present per factory.
  it("LIVE-source: createOpenAIBackend guards on OPENAI_API_KEY (returns null when unset)", () => {
    const s = src(FILE.openai);
    expect(s).toMatch(/export function createOpenAIBackend\(\)\s*:\s*OpenAIBackend\s*\|\s*null/);
    expect(s).toMatch(/process\.env\.OPENAI_API_KEY/);
    expect(s).toMatch(/if\s*\(!\s*key\s*\)\s*return null/);
  });

  it("LIVE-source: createAnthropicBackend guards on ANTHROPIC_API_KEY", () => {
    const s = src(FILE.anthropic);
    expect(s).toMatch(/export function createAnthropicBackend\(\)\s*:\s*AnthropicBackend\s*\|\s*null/);
    expect(s).toMatch(/process\.env\.ANTHROPIC_API_KEY/);
    expect(s).toMatch(/if\s*\(!\s*key\s*\)\s*return null/);
  });

  it("LIVE-source: createGeminiBackend guards on GOOGLE_AI_API_KEY", () => {
    const s = src(FILE.gemini);
    expect(s).toMatch(/export function createGeminiBackend\(\)\s*:\s*GeminiBackend\s*\|\s*null/);
    expect(s).toMatch(/process\.env\.GOOGLE_AI_API_KEY/);
    expect(s).toMatch(/if\s*\(!\s*key\s*\)\s*return null/);
  });

  it("LIVE-source: local factories guard on their URL env (OLLAMA_URL / VLLM_GENERATION_URL)", () => {
    const s = src(FILE.openaiCompat);
    // §19.4 lists OLLAMA_URL + VLLM_GENERATION_URL explicitly as the "uses what it has" anchors.
    expect(s).toMatch(/export function createOllamaBackend\(\)\s*:\s*OpenAICompatBackend\s*\|\s*null/);
    expect(s).toMatch(/const url = process\.env\.OLLAMA_URL;\s*\n\s*if\s*\(!url\)\s*return null/);
    expect(s).toMatch(/export function createVLLMBackend\(\)\s*:\s*OpenAICompatBackend\s*\|\s*null/);
    expect(s).toMatch(/const url = process\.env\.VLLM_GENERATION_URL;\s*\n\s*if\s*\(!url\)\s*return null/);
  });

  it("false-positive guard (LIVE-source): a factory MUST NOT fabricate a backend from an empty/placeholder key", () => {
    // "uses what it has" must be strict: an UNSET env ⇒ null. The guard is `if (!key)`, which also
    // rejects "" (empty string). The factory must NOT, e.g., default to a hardcoded key or skip the guard.
    const o = src(FILE.openai);
    // There must be NO `?? "sk-..."` / `|| "..."` style hardcoded fallback inside the factory function body.
    const factoryBody = o.slice(o.indexOf("export function createOpenAIBackend"));
    expect(factoryBody, "createOpenAIBackend must not hardcode a fallback key").not.toMatch(/return new OpenAIBackend\(["'`]/);
  });

  // (b) Behavioral replica of the documented contract (positive + negative), so the polarity is
  //     exercised at runtime even though the real module can't be imported here.
  function factoryReplica(env: Record<string, string | undefined>, key: string): { kind: string } | null {
    const v = env[key];
    if (!v) return null; // mirrors `if (!key) return null` / `if (!url) return null`
    return { kind: key.includes("OLLAMA") || key.includes("VLLM") ? "local" : "cloud" };
  }

  it("positive: present env → factory yields an available backend (non-null)", () => {
    expect(factoryReplica({ OPENAI_API_KEY: "sk-present" }, "OPENAI_API_KEY")).not.toBeNull();
    expect(factoryReplica({ OLLAMA_URL: "http://ollama:11434" }, "OLLAMA_URL")).toEqual({ kind: "local" });
  });

  it("negative: absent env → factory yields null (backend unavailable)", () => {
    expect(factoryReplica({}, "OPENAI_API_KEY")).toBeNull();
    expect(factoryReplica({ ANTHROPIC_API_KEY: "" }, "ANTHROPIC_API_KEY")).toBeNull(); // empty == unset
  });

  it("LIVE-source: createGatewayBackend requires BOTH url AND key (either unset ⇒ null)", () => {
    const s = src(FILE.openaiCompat);
    expect(s).toMatch(/export function createGatewayBackend\(\)\s*:\s*OpenAICompatBackend\s*\|\s*null/);
    expect(s).toMatch(/process\.env\.AISHA_LLM_GATEWAY_URL/);
    expect(s).toMatch(/process\.env\.AISHA_LLM_GATEWAY_KEY/);
    expect(s).toMatch(/if\s*\(!url\s*\|\|\s*!apiKey\)\s*return null/);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 3. Tier fallback chain env → DB(get_adaptive_model_tiers) → hardcoded default  (§6/§19.4)
//    LIVE source-level: assert the three-stage chain + env var names exist in orchestrationBridge.ts.
// ═════════════════════════════════════════════════════════════════════════════
d("discovery · tier fallback chain env→DB→default (§6/§19.4, LIVE source)", () => {
  it("positive: env layer — cloud tiers read MODEL_TIER_* (getCloudModelTiers)", () => {
    const s = src(FILE.orchestrationBridge);
    expect(s).toMatch(/function getCloudModelTiers\(\)/);
    // Exact env knobs documented in §19.4 "tiery fallback env→…".
    expect(s).toMatch(/process\.env\.MODEL_TIER_GREETING/);
    expect(s).toMatch(/process\.env\.MODEL_TIER_COMPLEX/);
    expect(s).toMatch(/process\.env\.MODEL_TIER_DEEP/);
  });

  it("positive: env layer — local tiers read MODEL_LOCAL_* (getLocalModelTiers, local-mode anchor)", () => {
    const s = src(FILE.orchestrationBridge);
    expect(s).toMatch(/function getLocalModelTiers\(\)/);
    expect(s).toMatch(/process\.env\.MODEL_LOCAL_GREETING/);
    expect(s).toMatch(/process\.env\.MODEL_LOCAL_DEEP/);
  });

  it("positive: DB layer — adaptive tiers come from rpc('get_adaptive_model_tiers'), gated to non-local mode", () => {
    const s = src(FILE.orchestrationBridge);
    expect(s).toMatch(/rpc\(["']get_adaptive_model_tiers["']\)/);
    // selectOptimalModel must NOT consult the cloud registry in local mode (registry holds cloud models).
    expect(s).toMatch(/if\s*\(\s*mode\s*!==\s*["']local["']\s*&&\s*pgrest\s*\)/);
  });

  it("positive: default layer — getFallbackModelTiers is the execution-mode-aware terminal fallback", () => {
    const s = src(FILE.orchestrationBridge);
    expect(s).toMatch(/function getFallbackModelTiers\(\)/);
    expect(s).toMatch(/let modelTiers = getFallbackModelTiers\(\)/); // selectOptimalModel seeds from fallback
  });

  it("false-positive guard: registry RPC failure MUST NOT crash — falls back, never throws past the boundary", () => {
    const s = src(FILE.orchestrationBridge);
    // resolveModelTiersFromRegistry returns null on error/empty and the caller keeps the fallback tiers.
    expect(s).toMatch(/if\s*\(error\s*\|\|\s*!data\s*\|\|\s*typeof data !== ["']object["']\)\s*return null/);
    expect(s).toMatch(/source:\s*["']registry["']\s*\|\s*["']fallback["']/);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 4. aisha_resolve_clow_backend — env-availability + allow_local boost/filter  (§6/§11)
//    LIVE DB (self-skips without DB). The resolver is the authoritative backend chooser.
//    positive: function exists; allow_local boosts local candidates.
//    false-positive: allow_local=false MUST exclude local backends from candidates.
// ═════════════════════════════════════════════════════════════════════════════
d("discovery · aisha_resolve_clow_backend allow_local (§6/§11, LIVE DB)", () => {
  it("LIVE: aisha_resolve_clow_backend(jsonb,jsonb) exists (authoritative resolver, baseline:17681)", async () => {
    let db: QueryFn;
    try { db = requireDb(); } catch { return; }
    const r = await db(
      `SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
       WHERE n.nspname='public' AND p.proname='aisha_resolve_clow_backend'`,
    );
    expect(r.rows.length).toBeGreaterThan(0);
  });

  it("LIVE-source: resolver body BOOSTS local candidates when allow_local=true (+0.20 score term)", async () => {
    let db: QueryFn;
    try { db = requireDb(); } catch { return; }
    const r = await db(
      `SELECT pg_get_functiondef(p.oid) AS def FROM pg_proc p
       JOIN pg_namespace n ON n.oid = p.pronamespace
       WHERE n.nspname='public' AND p.proname='aisha_resolve_clow_backend' LIMIT 1`,
    );
    const def = String(r.rows[0]?.def ?? "");
    // baseline.sql:17763 — local backends get a score bonus when v_allow_local is true.
    expect(def).toMatch(/local_ollama['"]?\s*,\s*['"]?local_vllm/);
    expect(def, "allow_local must add a local score bonus").toMatch(/AND\s+v_allow_local\s+THEN\s+0\.20/);
  });

  it("false-positive guard (LIVE-source): allow_local=false MUST FILTER OUT local backends (not merely deprioritize)", async () => {
    let db: QueryFn;
    try { db = requireDb(); } catch { return; }
    const r = await db(
      `SELECT pg_get_functiondef(p.oid) AS def FROM pg_proc p
       JOIN pg_namespace n ON n.oid = p.pronamespace
       WHERE n.nspname='public' AND p.proname='aisha_resolve_clow_backend' LIMIT 1`,
    );
    const def = String(r.rows[0]?.def ?? "");
    // baseline.sql:17790-17793 — WHERE clause: (v_allow_local OR backend_kind NOT IN local_*).
    // §11 governance: confidential ⇒ allow_local=true ⇒ cloud filtered; the inverse must hard-exclude local.
    expect(
      /v_allow_local\s+OR\s+p\.backend_kind\s+NOT IN\s*\(\s*['"]local_ollama['"]\s*,\s*['"]local_vllm['"]\s*\)/.test(def),
      "resolver must EXCLUDE local backends when allow_local=false (hard filter, not just score)",
    ).toBe(true);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 5. Per-instance registry RLS — FALSE-POSITIVE guard  (§19.3 / §19.4 GAP / §20 P1 #12)
//    LIVE DB, INTENTIONALLY RED. Today ai_provider_registry is readable by ANY authenticated user
//    (policy "ai_provider_registry_authenticated_read" USING auth.uid() IS NOT NULL — NO tenant filter),
//    and aisha_resolve_clow_backend is SECURITY DEFINER bypassing RLS → an instance-A user can enumerate
//    instance-B-restricted models. These guards MUST stay RED until instance-scoped RLS lands IN THE BASE.
// ═════════════════════════════════════════════════════════════════════════════
d("discovery · per-instance registry RLS (§19.4 GAP / §20 P1 #12, LIVE-RED guard)", () => {
  it("LIVE: ai_provider_registry exists with RLS ENABLED (surface that exists today)", async () => {
    let db: QueryFn;
    try { db = requireDb(); } catch { return; }
    const r = await db(
      `SELECT c.relrowsecurity FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
       WHERE n.nspname='public' AND c.relname='ai_provider_registry'`,
    );
    expect(r.rows.length).toBe(1);
    expect(r.rows[0]?.relrowsecurity, "RLS must be enabled on ai_provider_registry").toBe(true);
  });

  it("LIVE-RED: ai_provider_registry MUST carry an instance/tenant scoping column (RED until base RLS lands)", async () => {
    let db: QueryFn;
    try { db = requireDb(); } catch { return; }
    // §19.4 GAP: "per-instance restrikce modelů NENÍ vynutitelná". A scoping column is the precondition
    // for an instance-scoped RLS predicate. None of these exist today → INTENDED to FAIL.
    const r = await db(
      `SELECT column_name FROM information_schema.columns
       WHERE table_schema='public' AND table_name='ai_provider_registry'
         AND column_name IN ('tenant_id','account_id','instance_id','scoped_to_instance_id','allowed_instances')`,
    );
    expect(
      r.rows.length,
      "ai_provider_registry has no tenant/instance column → cross-instance model enumeration (§19.4 GAP)",
    ).toBeGreaterThan(0);
  });

  it("LIVE-RED: registry read policy MUST be tenant-scoped, NOT 'any authenticated user' (RED until fix)", async () => {
    let db: QueryFn;
    try { db = requireDb(); } catch { return; }
    const r = await db(
      `SELECT qual FROM pg_policies
       WHERE schemaname='public' AND tablename='ai_provider_registry' AND cmd='SELECT'`,
    );
    // Today the SELECT policy qual is "((auth.uid() IS NOT NULL) OR (auth.role() = 'service_role'))" —
    // it references NO scoping column. A correct per-instance policy must reference a tenant/instance column.
    const quals = r.rows.map((row) => String(row.qual ?? ""));
    const anyTenantScoped = quals.some((q) =>
      /tenant_id|account_id|instance_id|scoped_to_instance/.test(q),
    );
    expect(
      anyTenantScoped,
      "ai_provider_registry SELECT policy is broad (auth.uid() IS NOT NULL) → no per-instance isolation (§19.3/§19.4)",
    ).toBe(true);
  });

  it("LIVE-RED: resolver is SECURITY DEFINER but MUST tenant-filter candidates (RED until fix)", async () => {
    let db: QueryFn;
    try { db = requireDb(); } catch { return; }
    // §19.3: aisha_resolve_clow_backend is SECURITY DEFINER → bypasses RLS. Its candidate query joins
    // ai_provider_registry × ai_model_registry with NO tenant predicate, so even tenant-scoped registry RLS
    // would be bypassed here. The fix must add an explicit tenant filter inside the SECURITY DEFINER body.
    const r = await db(
      `SELECT pg_get_functiondef(p.oid) AS def, p.prosecdef
       FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
       WHERE n.nspname='public' AND p.proname='aisha_resolve_clow_backend' LIMIT 1`,
    );
    const def = String(r.rows[0]?.def ?? "");
    expect(r.rows[0]?.prosecdef, "resolver is SECURITY DEFINER (RLS-bypassing) per §19.3").toBe(true);
    // INTENDED to FAIL: the candidate query must constrain by a caller-derived tenant/instance.
    expect(
      /FROM\s+public\.ai_provider_registry\s+p[\s\S]*?(tenant_id|account_id|instance_id|scoped_to_instance)/.test(def),
      "SECURITY DEFINER resolver enumerates ALL providers (no tenant filter) → cross-instance leak (§19.3)",
    ).toBe(true);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 6. Base enforces; instance customizes ONLY via env/DB-seed/fork-folder  (§19.4)  — structural, LIVE
//    "INSTANCE … NESMÍ přidávat tenant kód do routing/gateway/governance."
//    false-positive guard: no tenant-specific identifiers leak into the base routing/governance code.
// ═════════════════════════════════════════════════════════════════════════════
d("discovery · base has no tenant-specific routing/governance code (§19.4, LIVE structural)", () => {
  // The §19.4 sanctioned customization surfaces are: config overlay, DB seeds, delimited fork folders
  // (e.g. src/cheers/, aisha/db/sql/tables/cheers/). The base routing/gateway/governance modules must
  // stay tenant-agnostic. We scan the REAL base files for hardcoded tenant/brand/fork identifiers.
  const BASE_FILES = [
    `${SVC}/lib/orchestrationBridge.ts`,
    `${SVC}/lib/governedOrchestration.ts`,
    `${DISPATCH}/providers/openai-compat.ts`,
    `${DISPATCH}/executionMode.ts`,
  ];
  // Tenant/fork markers that MUST NOT appear hardcoded in base routing/governance.
  // (Real fork-folder token from §19.4 = "cheers"; brand tenant resolution is runtime DB only.)
  const FORBIDDEN = /\bcheers\b|branding_hostname_mapping\s*=|TENANT_OVERRIDE|if\s*\(\s*tenant\s*===?\s*["']/;

  it("false-positive guard: base routing/governance files contain NO hardcoded tenant/fork identifiers", () => {
    for (const rel of BASE_FILES) {
      const s = src(resolve(process.cwd(), rel));
      expect(FORBIDDEN.test(s), `base file ${rel} must not hardcode tenant/fork logic (§19.4)`).toBe(false);
    }
  });

  it("positive: execution gating + tier maps are env/DB-driven (no per-instance branch in the base)", () => {
    const s = src(FILE.orchestrationBridge);
    // Customization point is env (MODEL_TIER_*/MODEL_LOCAL_*) + DB (get_adaptive_model_tiers) — never a tenant switch.
    expect(s).toMatch(/getExecutionMode\(\)/);
    expect(s).not.toMatch(/switch\s*\(\s*tenant/);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 7. GET /v1/models — aisha-* tier family + cost metadata  (§5.5 / §20 P1 #12)  — SKIP-UNTIL-IMPL
//    GET /v1/models does NOT exist yet (§19 "Omni /v1 v kódu NEEXISTUJE"; today only admin-only /models/list).
//    HTTP-level only, no module import. Precise contract per cell. Un-skip + point OMNI_BASE_URL when landed.
// ═════════════════════════════════════════════════════════════════════════════
describe.skip("discovery · GET /v1/models contract (§5.5/§20 — SKIP until /v1 ingress exists)", () => {
  const BASE = process.env.OMNI_BASE_URL ?? "http://localhost:3011";
  const modelsUrl = `${BASE}/v1/models`;
  const PAT = "mcp_test_discovery"; // PAT-authed (§5.5 "/v1/models na Omni (PAT auth)")
  // The advertised inbound family (§5.5 "Rodina explicitních tierů"):
  const AISHA_TIERS = ["aisha-fast", "aisha-balanced", "aisha-deep", "aisha-reasoning", "aisha-onprem"];

  it.todo(
    // CONTRACT (positive, v1-models-discovery / omni-protocol-models-endpoint-omni-tier-family):
    //   GET /v1/models (Authorization: Bearer mcp_<PAT>) → 200
    //   body { "object": "list", "data": [{ "id": "aisha-fast", ... }, { "id": "aisha-balanced", ... }, ...] }.
    //   Assert: data[].id is exactly the AISHA_TIERS set (inbound family) — NOT raw provider model ids.
    "positive: /v1/models advertises the aisha-* tier family (object:list, ids = aisha-fast/balanced/deep/reasoning/onprem)",
  );

  it.todo(
    // CONTRACT (positive cost metadata, omni-protocol-models-endpoint-cost-metadata):
    //   Each entry carries cost-range metadata sourced from ai_model_registry
    //   (input_price_per_m / output_price_per_m, baseline.sql:2158) projected per tier, e.g.
    //   { "id":"aisha-fast", "cost_input_per_mtok":0.0001, "cost_output_per_mtok":0.0003, ... }.
    //   §5.5: "jedno opaque id = stejný vstup stojí 100× bez signálu klientovi" — cost MUST be advertised.
    "positive: each /v1/models entry includes cost_input_per_mtok + cost_output_per_mtok (no opaque single id)",
  );

  it.todo(
    // CONTRACT (false-positive guard, omni-protocol-models-endpoint-omni-tier-family / §2):
    //   The Omni /v1/models list MUST NOT leak raw provider model ids (gpt-5-mini, claude-sonnet-4-…,
    //   gemini-2.5-flash, ollama-mistral-nemo). §2: "passthrough inzeruje raw provider modely (různé seznamy
    //   záměrně)". Omni advertises ONLY the aisha-* family. Assert no data[].id matches a raw provider model.
    "false-positive guard: Omni /v1/models must NOT expose raw provider model ids (those belong to passthrough)",
  );

  it.todo(
    // CONTRACT (positive public-not-admin, registry-not-admin-only):
    //   §19.3 today: /models/list is admin-only + OpenAI-only. §20 P1 #12: GET /v1/models is PUBLIC to any
    //   authenticated PAT (not admin-only). A non-admin PAT MUST still get 200 with the full aisha-* family.
    "positive: GET /v1/models is PAT-public (any authenticated user lists tiers, not admin-only)",
  );

  it.todo(
    // CONTRACT (false-positive guard, registry-rls-instance-scoped / §19.4 GAP):
    //   An instance-A PAT calling /v1/models MUST NOT see instance-B-restricted tiers/models. Once
    //   instance-scoped registry RLS lands in the base, the advertised set is tenant-filtered. Today this is
    //   the GAP (§19.4) — when /v1/models is implemented it must honor the per-instance restriction.
    "false-positive guard: instance-A PAT must NOT enumerate instance-B-restricted models via /v1/models",
  );

  // keep real identifiers visible to readers/linters within the skipped block
  void [modelsUrl, PAT, AISHA_TIERS];
});

// ═════════════════════════════════════════════════════════════════════════════
// 8. model echo = REQUESTED tier, never silent fallback backend  (§5.5)  — SKIP-UNTIL-IMPL
//    POST /v1/chat/completions does not exist yet. HTTP-level only. unifiedChatStream chunk shape per §5.
// ═════════════════════════════════════════════════════════════════════════════
describe.skip("discovery · model field echoes requested tier (§5.5 — SKIP until /v1 ingress exists)", () => {
  const BASE = process.env.OMNI_BASE_URL ?? "http://localhost:3011";
  const completions = `${BASE}/v1/chat/completions`;

  it.todo(
    // CONTRACT (negative/echo, omni-protocol-model-echo-requested-tier / v1-model-echo-requested):
    //   POST /v1/chat/completions { model:"aisha-balanced", messages:[…] } where governance/availability
    //   silently resolves to a local backend. Every SSE chunk's "model" field MUST be "aisha-balanced"
    //   (the REQUESTED tier), NEVER the resolved backend (e.g. "ollama-mistral-nemo").
    //   The true backend is exposed ONLY via the X-Resolved-Backend debug header (§5.5).
    "negative: chunk.model echoes requested aisha-balanced even when resolved to a local backend (X-Resolved-Backend shows truth)",
  );

  it.todo(
    // CONTRACT (false-positive guard, §5.5 "nikdy tichý fallback backend"):
    //   The "model" field MUST NOT be a raw provider/backend id under ANY resolution path. A fallback that
    //   rewrites chunk.model to the actual backend is a contract violation (breaks client cost/identity).
    "false-positive guard: chunk.model must NEVER be silently replaced by the resolved backend id",
  );

  void completions;
});
