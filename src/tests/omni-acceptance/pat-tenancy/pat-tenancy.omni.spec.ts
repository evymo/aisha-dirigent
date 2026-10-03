/**
 * AISHA Omni — Acceptance: PAT validation + multi-tenant isolation matrix
 * Area: pat-tenancy  ·  Kinds: unit + integration
 * Spec source of truth: docs/planning/AISHA_OMNI_GATEWAY.md (v4)
 *   §8  Auth & PAT (prefix mcp_, validate_mcp_token → {user_id, story_id, ...})
 *   §8.5 PAT story/tenant binding BLOCKER (scoped_to_story_id, bind-at-issuance, fail-closed)
 *   §16 Multi-tenancy invariant (user = PAT→user_id, NEVER from body; ai_runs.story_id NOT NULL)
 *   §19.1 Story-binding cross-tenant hole (get_chat_context_story_id ownership)
 *   §20  Regression: PAT multi-tenant isolation matrix (scoped vs unscoped, mismatch→403, story_id NOT NULL)
 *
 * ISOLATION (per suite convention):
 *  - This file lives under src/tests/omni-acceptance/**\/*.omni.spec.ts and is intended to be
 *    run ONLY via the dedicated vitest.omni-acceptance.config.ts (mirroring vitest.gates.config.ts);
 *    that path is added to the default vitest.config.ts `exclude`.
 *  - As a defensive belt-and-suspenders measure (so this file can never break a normal CI run
 *    even before the dedicated config/exclude lands), the whole suite self-skips unless
 *    process.env.OMNI_ACCEPTANCE is set — same gating philosophy as the e2e/omni specs.
 *
 * SHARED SCAFFOLD (read-only, do NOT edit/recreate): when the suite-level
 *   src/tests/omni-acceptance/_helpers + _fixtures land, the LIVE DB/HTTP assertions below
 *   should consume them (pg client + PAT/story fixtures). Until then the live blocks are gated
 *   behind env-provided connection info and self-skip when absent — they never hard-fail CI.
 *
 * LIVE vs SKIP applied here:
 *  - validate_mcp_token EXISTS  → LIVE assertions (some intentionally RED: today's return shape
 *    has NO user_id / story_id / scoped_to_story_id → §8/§8.5 BLOCKER regression guard).
 *  - POST /v1/chat/completions, POST /v1/messages, edge PAT→JWT middleware (req.user.sub)
 *    DO NOT EXIST yet → describe.skip / it.todo with precise contract comments; no top-level
 *    import of any non-existent module (HTTP-level only, via dynamic fetch inside skipped blocks).
 */
import { describe, it, expect, beforeAll } from "vitest";

const ACCEPTANCE = Boolean(process.env.OMNI_ACCEPTANCE);
const d = ACCEPTANCE ? describe : describe.skip;

// Real identifiers grounded in code/spec (NO invented symbols):
//   table   public.mcp_auth_tokens          (baseline.sql:5318 — 15 cols today)
//   fn      public.validate_mcp_token(text,text,uuid)  (baseline.sql:89648, SECURITY DEFINER)
//   fn      public.create_mcp_token(...)     (baseline.sql:55079)
//   fn      public.get_chat_context_story_id(uuid,uuid) (baseline.sql:33936, SECURITY DEFINER)
//   table   public.ai_runs(story_id uuid /* nullable today */) (baseline.sql:2350)
//   route   POST /v1/chat/completions, POST /v1/messages  (spec §5 — NOT IMPLEMENTED)
const MCP_PREFIX = "mcp_";
const LEGACY_PREFIX = "sk-aisha-";

// ─────────────────────────────────────────────────────────────────────────────
// Optional LIVE DB harness. Self-skips unless a DB URL is provided AND `pg` loads.
// (When the shared _helpers land, replace this local bootstrap with the shared
//  pg-client helper — do NOT duplicate it permanently.)
// ─────────────────────────────────────────────────────────────────────────────
const DB_URL = process.env.AISHA_DB_URL || process.env.DATABASE_URL || "";
type QueryFn = (sql: string, params?: unknown[]) => Promise<{ rows: Array<Record<string, unknown>> }>;
let query: QueryFn | null = null;

beforeAll(async () => {
  if (!ACCEPTANCE || !DB_URL) return;
  try {
    // dynamic import: never a top-level dependency, so the file type-checks without `pg` installed
    const pgMod = (await import("pg")) as unknown as {
      Pool: new (cfg: { connectionString: string }) => {
        query: (sql: string, params?: unknown[]) => Promise<{ rows: Array<Record<string, unknown>> }>;
      };
    };
    const pool = new pgMod.Pool({ connectionString: DB_URL });
    query = (sql, params) => pool.query(sql, params);
  } catch {
    query = null; // pg not available → live DB assertions self-skip below
  }
});

function requireDb(): QueryFn {
  if (!query) {
    // No DB wired in this environment → mark as skipped at call site via expect.soft no-op.
    throw new Error("__SKIP_NO_DB__");
  }
  return query;
}

// ═════════════════════════════════════════════════════════════════════════════
// 1. PAT bearer-token FORMAT  (§8)  — unit, positive + false-positive
//    "POST /v1/chat/completions accepts Authorization: Bearer mcp_*; NOT sk-aisha-* on Omni"
// ═════════════════════════════════════════════════════════════════════════════
d("pat-tenancy · PAT bearer format (§8)", () => {
  // Pure parser-shape unit assertions — no module dependency, safe to run LIVE.
  function classifyAuth(header: string | undefined): "pat" | "legacy-pat" | "passthrough" | "none" {
    if (!header) return "none";
    const m = /^Bearer\s+(\S+)$/.exec(header);
    if (!m) return "none";
    const tok = m[1];
    if (tok.startsWith(MCP_PREFIX)) return "pat";
    if (tok.startsWith(LEGACY_PREFIX)) return "legacy-pat";
    return "passthrough"; // sk-… raw provider key → llm-passthrough, NOT Omni
  }

  it("positive: Bearer mcp_<token> classifies as a PAT (Omni lane)", () => {
    expect(classifyAuth("Bearer mcp_live_abc123")).toBe("pat");
  });

  it("false-positive guard: a raw provider key (sk-…) must NOT be treated as an Omni PAT", () => {
    // §2: Bearer sk-… is llm-passthrough (governance-bypass, dev-only) — must NOT enter Omni PAT path.
    expect(classifyAuth("Bearer sk-proj-OPENAI")).toBe("passthrough");
    expect(classifyAuth("Bearer sk-proj-OPENAI")).not.toBe("pat");
  });

  it("negative: malformed / missing Authorization is not a PAT", () => {
    expect(classifyAuth(undefined)).toBe("none");
    expect(classifyAuth("mcp_no_bearer_prefix")).toBe("none");
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 2. validate_mcp_token RETURN CONTRACT  (§8 / §8.5)  — integration, LIVE (intentionally RED)
//    Spec: validate_mcp_token(hash) → {user_id, story_id, scoped_to_story_id, ...}
//    TODAY (baseline.sql:89688) it returns ONLY {valid, scope, account_id, project_id, rate_limit_*}.
//    These LIVE assertions are REGRESSION GUARDS that MUST stay RED until the §8.5 migration adds
//    user_id FK + scoped_to_story_id and updates the function's return jsonb.
// ═════════════════════════════════════════════════════════════════════════════
d("pat-tenancy · validate_mcp_token return contract (§8.5 BLOCKER, LIVE-RED guard)", () => {
  it("LIVE: function validate_mcp_token(text,text,uuid) exists (surface that exists today)", async () => {
    let db: QueryFn;
    try { db = requireDb(); } catch { return; } // self-skip when no DB
    const r = await db(
      `SELECT 1 AS ok FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
       WHERE n.nspname = 'public' AND p.proname = 'validate_mcp_token'`,
    );
    expect(r.rows.length).toBeGreaterThan(0);
  });

  it("LIVE-RED: mcp_auth_tokens MUST have user_id column (§8 delta — RED until migration)", async () => {
    let db: QueryFn;
    try { db = requireDb(); } catch { return; }
    const r = await db(
      `SELECT 1 FROM information_schema.columns
       WHERE table_schema='public' AND table_name='mcp_auth_tokens' AND column_name='user_id'`,
    );
    // INTENDED to FAIL today (column absent). Proves §8 "chybí user_id FK" until landed.
    expect(r.rows.length, "mcp_auth_tokens.user_id absent → §8 PAT identity gap").toBe(1);
  });

  it("LIVE-RED: mcp_auth_tokens MUST have scoped_to_story_id column (§8.5 — RED until migration)", async () => {
    let db: QueryFn;
    try { db = requireDb(); } catch { return; }
    const r = await db(
      `SELECT 1 FROM information_schema.columns
       WHERE table_schema='public' AND table_name='mcp_auth_tokens' AND column_name='scoped_to_story_id'`,
    );
    // INTENDED to FAIL today. §8.5 BLOCKER: bind-at-issuance story scope.
    expect(r.rows.length, "mcp_auth_tokens.scoped_to_story_id absent → §8.5 BLOCKER").toBe(1);
  });

  it("LIVE-RED: validate_mcp_token return jsonb MUST surface user_id + story_id keys (§8.5)", async () => {
    let db: QueryFn;
    try { db = requireDb(); } catch { return; }
    // Inspect the function body source for the keys it builds into its jsonb result.
    // Today it builds {valid, scope, account_id, project_id, rate_limit_rpm, rate_limit_daily} → no user_id/story_id.
    const r = await db(
      `SELECT pg_get_functiondef(p.oid) AS def FROM pg_proc p
       JOIN pg_namespace n ON n.oid = p.pronamespace
       WHERE n.nspname='public' AND p.proname='validate_mcp_token' LIMIT 1`,
    );
    const def = String(r.rows[0]?.def ?? "");
    // RED until the migration rewrites validate_mcp_token to emit these enforcement keys.
    expect(def, "validate_mcp_token must emit 'user_id' for chargeback/audit (§8, §16)").toContain("'user_id'");
    expect(def, "validate_mcp_token must emit 'story_id' for story-scope enforcement (§8.5)").toContain("'story_id'");
    expect(def).toContain("scoped_to_story_id");
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 3. ai_runs.story_id NOT NULL invariant  (§16 / §8.5 / §20)  — integration, LIVE (intentionally RED)
//    "vše story_id NOT NULL" — the multi-tenancy invariant carrying RLS/chargeback/governance/audit.
//    TODAY ai_runs.story_id is NULLABLE (baseline.sql:2353) → guard MUST be RED until enforced.
// ═════════════════════════════════════════════════════════════════════════════
d("pat-tenancy · ai_runs.story_id NOT NULL invariant (§16/§20, LIVE-RED guard)", () => {
  it("LIVE-RED: ai_runs.story_id MUST be NOT NULL (RED until §8.5 binding lands)", async () => {
    let db: QueryFn;
    try { db = requireDb(); } catch { return; }
    const r = await db(
      `SELECT is_nullable FROM information_schema.columns
       WHERE table_schema='public' AND table_name='ai_runs' AND column_name='story_id'`,
    );
    expect(r.rows.length, "ai_runs.story_id column must exist").toBe(1);
    // INTENDED to FAIL today: is_nullable='YES'. Proves the invariant is not yet enforced.
    expect(r.rows[0]?.is_nullable, "ai_runs.story_id nullable → poisoned audit/chargeback (§16)").toBe("NO");
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 4. Story-resolver ownership  (§19.1)  — integration, LIVE (intentionally RED)
//    get_chat_context_story_id(p_story_id, p_user_id):
//      positive — owner's explicit story resolves to itself
//      negative — cross-tenant explicit story_id is RETURNED today (NO ownership check) → cross-tenant leak
//      false-positive — NULL story_id falls back to ARBITRARY active story today → must NOT
//    Schema note: the live fn keys ownership on partner_stories.user_id (NOT story_participants —
//    the spec's "story_participants" is the *target* design; we assert against the REAL column).
// ═════════════════════════════════════════════════════════════════════════════
d("pat-tenancy · get_chat_context_story_id ownership (§19.1, LIVE)", () => {
  it("LIVE: get_chat_context_story_id(uuid,uuid) exists (surface that exists today)", async () => {
    let db: QueryFn;
    try { db = requireDb(); } catch { return; }
    const r = await db(
      `SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
       WHERE n.nspname='public' AND p.proname='get_chat_context_story_id'`,
    );
    expect(r.rows.length).toBeGreaterThan(0);
  });

  it("LIVE-RED: resolver body MUST filter explicit p_story_id by ownership (RED until §19.1 fix)", async () => {
    let db: QueryFn;
    try { db = requireDb(); } catch { return; }
    const r = await db(
      `SELECT pg_get_functiondef(p.oid) AS def FROM pg_proc p
       JOIN pg_namespace n ON n.oid = p.pronamespace
       WHERE n.nspname='public' AND p.proname='get_chat_context_story_id' LIMIT 1`,
    );
    const def = String(r.rows[0]?.def ?? "");
    // Today the explicit-id branch only does `EXISTS (… WHERE ps.id = p_story_id)` — no user_id filter.
    // §19.1 fix must scope the explicit-id existence check to the caller (ps.user_id = p_user_id).
    // RED until then: assert the ownership-scoped existence check is present.
    expect(
      /ps\.id\s*=\s*p_story_id[\s\S]*?ps\.user_id\s*=\s*p_user_id/.test(def)
        || /ps\.user_id\s*=\s*p_user_id[\s\S]*?ps\.id\s*=\s*p_story_id/.test(def),
      "explicit p_story_id branch must be ownership-scoped (cross-tenant leak, §19.1)",
    ).toBe(true);
  });

  it("LIVE-RED: false-positive guard — resolver MUST NOT fall back to arbitrary active story (§19.1)", async () => {
    let db: QueryFn;
    try { db = requireDb(); } catch { return; }
    const r = await db(
      `SELECT pg_get_functiondef(p.oid) AS def FROM pg_proc p
       JOIN pg_namespace n ON n.oid = p.pronamespace
       WHERE n.nspname='public' AND p.proname='get_chat_context_story_id' LIMIT 1`,
    );
    const def = String(r.rows[0]?.def ?? "");
    // The current body has a final "Fallback: any active context-ready story" block that selects
    // from partner_stories with status='active' and NO user filter → returns ANY tenant's story.
    // §19.1 fix: remove the arbitrary-active fallback. RED until removed.
    const hasUnscopedFallback =
      /Fallback[\s\S]*?FROM\s+partner_stories\s+ps[\s\S]*?ps\.status\s*=\s*'active'/i.test(def)
      && !/Fallback[\s\S]*?ps\.user_id\s*=\s*p_user_id/i.test(def);
    expect(hasUnscopedFallback, "arbitrary-active fallback still present → cross-tenant fallback leak").toBe(false);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 4b. /v1 PAT story-isolation RUNTIME  (§8.5 / §20)  — LIVE HTTP, gated
//    The workflow flagged that §2 proves the COLUMN/return shape but not the
//    RUNTIME fail-closed enforcement. This block ACTUALLY exercises it: a PAT
//    bound to story A dispatching story B must 403 (body must NOT override the
//    token scope). Self-skips until /v1 + a story-A-scoped PAT are wired
//    (OMNI_BASE_URL + OMNI_PAT_SCOPED_A); becomes a real RED→GREEN at E-Omni.
//    Complements the it.todo matrix in §5 (which documents the full grid).
// ═════════════════════════════════════════════════════════════════════════════
d("pat-tenancy · /v1 PAT story-isolation runtime (§8.5/§20, LIVE HTTP gated)", () => {
  const BASE = (process.env.OMNI_BASE_URL ?? "").replace(/\/$/, "");
  const PAT_SCOPED_A = process.env.OMNI_PAT_SCOPED_A ?? ""; // a real mcp_ token bound to STORY_A
  const STORY_B = process.env.OMNI_STORY_B ?? "00000000-0000-4000-8000-0000000000b2";

  async function postV1(path: string, payload: unknown, pat: string): Promise<Response | null> {
    try {
      return await fetch(`${BASE}${path}`, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${pat}` },
        body: JSON.stringify(payload),
      });
    } catch {
      return null; // /v1 not running in this env → skip body
    }
  }

  it("LIVE runtime: scoped PAT(A) + body.story_id=B → 403 story_mismatch (fail-closed; body must NOT override token scope)", async () => {
    if (!BASE || !PAT_SCOPED_A) return; // self-skip until /v1 + scoped PAT are wired
    const res = await postV1(
      "/v1/chat/completions",
      { model: "aisha-fast", story_id: STORY_B, messages: [{ role: "user", content: "ping" }] },
      PAT_SCOPED_A,
    );
    if (!res) return; // /v1 not reachable → skip
    expect(res.status).toBe(403);
    const j = (await res.json().catch(() => ({}))) as { error?: string };
    expect(j.error).toBe("story_mismatch");
  });

  it("LIVE runtime: scoped PAT(A) + NO body story → 200, story derived from token scope (not a body-supplied default)", async () => {
    if (!BASE || !PAT_SCOPED_A) return;
    const res = await postV1(
      "/v1/chat/completions",
      { model: "aisha-fast", messages: [{ role: "user", content: "ping" }] },
      PAT_SCOPED_A,
    );
    if (!res) return;
    // Token-derived story → not a 4xx tenancy rejection. (Stream/202 both acceptable.)
    expect([401, 403]).not.toContain(res.status);
    expect(res.headers.get("x-aisha-run-id") ?? "").not.toBe("");
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 5. /v1 multi-tenant isolation MATRIX  (§8.5 / §16 / §20)  — integration, SKIP-UNTIL-IMPL
//    POST /v1/chat/completions + POST /v1/messages DO NOT EXIST yet (spec §5, §19 "v kódu NEEXISTUJE").
//    HTTP-level only (no module import). Precise contract per matrix cell below.
//    When implemented, point OMNI_BASE_URL at the running /v1 ingress and un-skip.
// ═════════════════════════════════════════════════════════════════════════════
describe.skip("pat-tenancy · /v1 isolation matrix (§8.5/§16/§20 — SKIP until /v1 ingress exists)", () => {
  const BASE = process.env.OMNI_BASE_URL ?? "http://localhost:3011";
  const completions = `${BASE}/v1/chat/completions`;
  const messages = `${BASE}/v1/messages`;

  // Fixtures (replace with shared _fixtures once they land): tokens are bound at issuance.
  const PAT_SCOPED_A = "mcp_test_scoped_storyA"; // mcp_auth_tokens.scoped_to_story_id = STORY_A
  const PAT_UNSCOPED = "mcp_test_unscoped";      // mcp_auth_tokens.scoped_to_story_id IS NULL (legacy)
  const STORY_A = "00000000-0000-4000-8000-0000000000a1";
  const STORY_B = "00000000-0000-4000-8000-0000000000b2"; // foreign tenant

  function body(extra: Record<string, unknown> = {}) {
    return JSON.stringify({
      model: "aisha-fast",
      messages: [{ role: "user", content: "ping" }],
      ...extra,
    });
  }

  it.todo(
    // CONTRACT (positive, omni-protocol-pat-bearer-token-format / sec-pat-story-binding-positive):
    //   Authorization: Bearer mcp_<PAT_SCOPED_A>, body has NO story_id.
    //   → 200, story derived from PAT (scoped_to_story_id=STORY_A). Resulting ai_runs.story_id = STORY_A.
    //   Assert: resp.ok; header X-AISHA-Run-ID present; the run's story_id == STORY_A (via /reflect/runs/{id} or DB).
    "positive: scoped PAT + no body story → uses token scope (story_id = STORY_A)",
  );

  it.todo(
    // CONTRACT (FALSE-POSITIVE guard, omni-protocol-pat-story-binding-required / sec-pat-story-binding-negative):
    //   Authorization: Bearer mcp_<PAT_SCOPED_A>, body.story_id = STORY_B (foreign).
    //   §8.5 "odvodit story z PATu (ignorovat/validovat body)". Body MUST NOT override the token scope.
    //   Expected: 403 { "error": "story_mismatch" }. The body's STORY_B must never reach a run.
    //   This is the false-positive guard: the system must NOT accept a body-supplied cross-tenant story_id.
    "false-positive guard: scoped PAT(A) + body story_id=B → 403 story_mismatch (body must NOT override)",
  );

  it.todo(
    // CONTRACT (negative/fail-closed, omni-protocol-pat-unscoped-rejected / sec-pat-story-binding-false-positive):
    //   Authorization: Bearer mcp_<PAT_UNSCOPED> (scoped_to_story_id IS NULL), body has NO story_id.
    //   §8.5 "fail-closed když neurčeno". MUST NOT infer/auto-pick a story.
    //   Expected: 403 { "error": "unscoped_token" } (or 403 story-required) — never a silent default story.
    "negative: unscoped PAT + no body story → 403 fail-closed (unscoped_token)",
  );

  it.todo(
    // CONTRACT (positive ignore-body, omni-protocol-pat-body-story-ignored):
    //   Authorization: Bearer mcp_<PAT_SCOPED_A>, body.story_id = STORY_A (matches scope).
    //   story_id derived from token; matching body value is harmless. → 200, run.story_id = STORY_A.
    //   (Distinct from the mismatch cell: a MATCHING body value is accepted/ignored, not 403.)
    "positive: scoped PAT(A) + body story_id=A (matching) → 200, story_id=A (body ignored, not error)",
  );

  it.todo(
    // CONTRACT (invariant, regtest-pat-isolation-matrix / §16):
    //   For EVERY successful /v1 dispatch, the resulting ai_runs row has story_id NOT NULL.
    //   Assert by polling X-AISHA-Run-ID → /reflect/runs/{id} or DB: ai_runs.story_id IS NOT NULL.
    "invariant: every /v1 dispatch yields ai_runs.story_id NOT NULL",
  );

  it.todo(
    // CONTRACT (Anthropic surface parity, §5 /v1/messages):
    //   Same matrix applies to POST /v1/messages (Claude Code / Cursor agent mode via ANTHROPIC_BASE_URL).
    //   scoped PAT(A) + Anthropic body with foreign story metadata → 403 story_mismatch; both surfaces funnel
    //   into unifiedChatStream and share the SAME story-binding gate.
    "false-positive guard: /v1/messages scoped PAT(A) + foreign story → 403 story_mismatch",
  );

  // touch identifiers so the skipped block keeps real symbols visible to readers/linters
  void [completions, messages, PAT_SCOPED_A, PAT_UNSCOPED, STORY_A, STORY_B, body];
});

// ═════════════════════════════════════════════════════════════════════════════
// 6. Edge PAT → JWT context  (§8)  — unit, SKIP-UNTIL-IMPL
//    "Edge middleware: Bearer mcp_/sk-aisha- → validate_mcp_token → mintnout JWT kontext + req.user.sub = user_id"
//    Middleware does not exist yet → it.todo with precise contract; NO module import.
// ═════════════════════════════════════════════════════════════════════════════
describe.skip("pat-tenancy · edge PAT→JWT context (§8 — SKIP until middleware exists)", () => {
  it.todo(
    // CONTRACT (omni-protocol-pat-jwt-context-set):
    //   After the edge middleware validates Bearer mcp_<token> via validate_mcp_token, it mints a JWT
    //   context and sets req.user.sub = user_id (from the token row). Downstream routes read req.user.sub
    //   for chargeback + audit. Negative: an invalid/expired token → 401 and req.user is unset (no anon fallthrough).
    "positive: valid Bearer mcp_ sets req.user.sub = user_id; invalid → 401 (no anon context)",
  );
});
