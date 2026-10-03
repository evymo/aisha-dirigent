/**
 * Omni acceptance — area: story-resolver-hole (§19.1, §4.4, §4.6, §16, §20)
 * ----------------------------------------------------------------------------
 * Source of truth: docs/planning/AISHA_OMNI_GATEWAY.md (v4).
 *
 * Part of the Omni ACCEPTANCE suite — collected ONLY by
 * vitest.omni-acceptance.config.ts (the default vitest.config.ts EXCLUDES
 * src/tests/omni-acceptance/**). The whole file self-skips unless
 * process.env.OMNI_ACCEPTANCE is set (same gating philosophy as the sibling
 * pat-tenancy/quota-admission specs and the e2e/omni specs).
 *
 * COMPLEMENT, not duplicate: pat-tenancy.omni.spec.ts §4 pins the resolver hole
 * STATICALLY (inspects the function body via pg_get_functiondef). THIS file pins
 * the hole at RUNTIME — it actually EXECUTES get_chat_context_story_id with TWO
 * tenants and asserts the returned story id, which is the stronger proof — plus
 * it covers the /dirigent/dispatch ownership asymmetry that pat-tenancy does not.
 *
 * AREA CONTRACT (§19.1 — central story-binding invariant, today UNENFORCED):
 *
 *   BUG A (cross-tenant ownership, LIVE expected-RED):
 *     get_chat_context_story_id (aisha/db/sql/functions/get_chat_context_story_id.sql;
 *     baseline.sql:33936, SECURITY DEFINER) with an explicit p_story_id only
 *     checks EXISTENCE — `IF EXISTS (SELECT 1 FROM partner_stories ps WHERE
 *     ps.id = p_story_id)` (:20) — NOT ownership vs p_user_id. A caller passes
 *     ANOTHER user's story id and gets it back → cross-tenant leak.
 *
 *   BUG B (arbitrary-active fallback, LIVE expected-RED, FALSE-POSITIVE guard):
 *     The final fallback (:42-:50) selects `WHERE ps.status = 'active'` with NO
 *     `ps.user_id = p_user_id` filter → for a user who owns nothing it returns
 *     SOMEONE ELSE'S active story. The resolver MUST fail-closed (NULL).
 *
 *   BUG C (dispatch asymmetry, LIVE expected-RED, route/HTTP-level):
 *     POST /dirigent/dispatch (services/svc-ai-chat/src/routes/dirigent-supervisor.ts)
 *     takes user_id from the verified JWT sub (trusted, :159/:189) but forwards
 *     `body.story_id` with NO ownership check (:158/:181/:200/:220/:240/:294).
 *     It MUST derive/validate story ownership, not trust body.story_id.
 *
 *   INVARIANT (§19.1 / §20 P0 #5): ai_runs.story_id (baseline.sql:2350, nullable
 *     today) MUST become NOT NULL — carries RLS/chargeback/governance/audit.
 *
 *   FALSE-POSITIVE — schema-evolution graceful degrade (§20 regresní pojistky:
 *     "neznámý event type nespadne"): an UNKNOWN /dirigent/dispatch event type
 *     (outside VALID_EVENTS = {session_start, prompt_submit, pre_tool, post_tool,
 *     stop}, dirigent-supervisor.ts:34-40) must NOT be treated as a valid nudge
 *     dispatch — it must 400 invalid_event.
 *
 *   FIX (base, §19.1 + §20 P0 #5 / P1 #12): one shared
 *     resolveAndValidateStoryId(userId, explicitStoryId?, pgrest) for every JWT
 *     route; PAT routes derive from scope; ownership enforced + arbitrary-active
 *     fallback removed. (Skip-until-impl block below carries that contract.)
 *
 * LIVE vs SKIP:
 *   - get_chat_context_story_id / partner_stories / story_participants / ai_runs /
 *     POST /dirigent/dispatch EXIST today → LIVE (several intentionally RED,
 *     proving the current bug; regression guards that flip GREEN post-fix).
 *   - resolveAndValidateStoryId, mcp_auth_tokens.scoped_to_story_id, PAT story
 *     binding on POST /v1/chat/completions do NOT exist yet → describe.skip /
 *     it.todo with precise contracts; NEVER top-level import a non-existent module.
 *
 * LIVE DB harness (mirrors pat-tenancy.omni.spec.ts; replace with the shared
 * _helpers pg-client when it lands — do NOT permanently duplicate):
 *   process.env.OMNI_ACCEPTANCE          — required to run anything
 *   process.env.AISHA_DB_URL / DATABASE_URL — superuser DSN (SECURITY DEFINER fn
 *                                          reads p_user_id from the arg, so two
 *                                          tenants are simulated by varying it)
 * LIVE HTTP harness (dispatch route):
 *   process.env.OMNI_BASE_URL            — svc-ai-chat base (default localhost:3011)
 *   process.env.OMNI_TENANT_A_JWT        — JWT whose sub owns the seeded story
 *   process.env.OMNI_TENANT_B_JWT        — JWT whose sub owns nothing
 */
import { describe, it, expect, beforeAll } from "vitest";
import { randomUUID } from "node:crypto";

const ACCEPTANCE = Boolean(process.env.OMNI_ACCEPTANCE);
const d = ACCEPTANCE ? describe : describe.skip;

// ─────────────────────────────────────────────────────────────────────────────
// LIVE DB harness — dynamic import("pg"), self-skips without a DSN or `pg`.
// ─────────────────────────────────────────────────────────────────────────────
const DB_URL = process.env.AISHA_DB_URL || process.env.DATABASE_URL || "";
type QueryFn = (sql: string, params?: unknown[]) => Promise<{ rows: Array<Record<string, unknown>> }>;
let query: QueryFn | null = null;

// Two-tenant fixture: tenant A owns an active story; tenant B owns nothing.
const tenantA = randomUUID();
const tenantB = randomUUID();
const storyA = randomUUID();

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
    // Seed FK-safe principals + a story owned by tenant A. Idempotent.
    await query(`INSERT INTO aisha_auth.users (id) VALUES ($1),($2) ON CONFLICT DO NOTHING`, [tenantA, tenantB]);
    await query(
      `INSERT INTO partner_stories (id, user_id, title, status) VALUES ($1,$2,$3,'active') ON CONFLICT DO NOTHING`,
      [storyA, tenantA, "omni-acceptance story-resolver tenant-A story"],
    );
    await query(
      `INSERT INTO story_participants (story_id, user_id, role) VALUES ($1,$2,'owner') ON CONFLICT DO NOTHING`,
      [storyA, tenantA],
    );
  } catch {
    query = null; // pg missing / connect failed → live DB assertions self-skip
  }
});

function requireDb(): QueryFn {
  if (!query) throw new Error("__SKIP_NO_DB__"); // env without a DB → treated as skip at call site
  return query;
}

/** Execute the resolver and return its scalar uuid (or null). */
async function resolve(pStoryId: string | null, pUserId: string): Promise<string | null> {
  const q = requireDb();
  const r = await q(`SELECT public.get_chat_context_story_id($1::uuid, $2::uuid) AS sid`, [pStoryId, pUserId]);
  return (r.rows[0]?.sid as string | null) ?? null;
}

// ═════════════════════════════════════════════════════════════════════════════
// 1. get_chat_context_story_id RUNTIME ownership (§19.1) — LIVE
// ═════════════════════════════════════════════════════════════════════════════
d("story-resolver-hole · get_chat_context_story_id runtime ownership (§19.1, LIVE)", () => {
  // POSITIVE — owner's own explicit story resolves (sec-resolver-ownership-positive)
  it("LIVE positive: owner passing their own p_story_id gets that story back", async () => {
    try {
      expect(await resolve(storyA, tenantA)).toBe(storyA);
    } catch (e) {
      if ((e as Error).message === "__SKIP_NO_DB__") return; // no DB wired → skip body
      throw e;
    }
  });

  // NEGATIVE — cross-tenant explicit p_story_id MUST NOT resolve for a non-owner.
  // EXPECTED-RED TODAY: existence-only check (:20) returns storyA to tenant B.
  // sec-resolver-ownership-negative / regtest-story-resolver-ownership.
  it("LIVE-RED negative: a foreign p_story_id must NOT resolve for a non-owner", async () => {
    try {
      const out = await resolve(storyA, tenantB); // storyA owned by A, B is not a participant
      // Fix contract: ownership enforced → NULL (or a future 42501 raise, caught above).
      expect(out).not.toBe(storyA);
      expect(out).toBeNull();
    } catch (e) {
      if ((e as Error).message === "__SKIP_NO_DB__") return;
      throw e; // a thrown 42501 from a future guard would surface here as a real DB error
    }
  });

  // FALSE-POSITIVE — arbitrary-active fallback must NOT leak someone else's story.
  // EXPECTED-RED TODAY: B owns nothing → owner-scoped SELECT (:26-:35) is NULL →
  // unscoped fallback (:42-:50) returns storyA. Resolver MUST fail-closed (NULL).
  // sec-resolver-ownership-false-positive (BUG B).
  it("LIVE-RED false-positive: NULL story + story-less user must fail-closed, not leak an arbitrary active story", async () => {
    try {
      const out = await resolve(null, tenantB);
      expect(out).not.toBe(storyA); // the specific leak today
      expect(out).toBeNull(); // the correct fail-closed result
    } catch (e) {
      if ((e as Error).message === "__SKIP_NO_DB__") return;
      throw e;
    }
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 2. POST /dirigent/dispatch story ownership + event whitelist (§19.1, §4.4) — LIVE HTTP
//    Route EXISTS today; asserted at the HTTP layer only — handler module never imported.
// ═════════════════════════════════════════════════════════════════════════════
const BASE = process.env.OMNI_BASE_URL ?? "http://localhost:3011";
const JWT_A = process.env.OMNI_TENANT_A_JWT ?? "";
const JWT_B = process.env.OMNI_TENANT_B_JWT ?? "";

async function dispatch(jwt: string, body: unknown): Promise<Response | null> {
  try {
    return await fetch(`${BASE.replace(/\/$/, "")}/dirigent/dispatch`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${jwt}` },
      body: JSON.stringify(body),
    });
  } catch {
    return null; // service not running in this env → skip body
  }
}

d("story-resolver-hole · POST /dirigent/dispatch ownership (§19.1/§4.4, LIVE)", () => {
  // NEGATIVE — body.story_id must be validated against the JWT identity, not trusted.
  // EXPECTED-RED TODAY: route forwards body.story_id with no ownership check
  // (:158/:181/:220/:294). Fix: resolveAndValidateStoryId(user.userId,
  // body.story_id) → foreign/mismatch fails closed (403 preferred, never silent
  // accept). sec-cross-tenant-dispatch-negative.
  it("LIVE-RED negative: dispatch (KNOWN-VALID event) + foreign body.story_id → 403 fail-closed, not trusted", async () => {
    if (!JWT_B) return; // requires a real tenant-B JWT for the live matrix
    // KNOWN-VALID event (prompt_submit) + foreign story → must be the OWNERSHIP
    // rejection (403), not just any 4xx. Today the route trusts body.story_id with no
    // ownership check → RED until resolveAndValidateStoryId lands (§19.1 / E-Omni-1).
    const res = await dispatch(JWT_B, { event: "prompt_submit", story_id: storyA });
    if (!res) return; // service down → skip
    expect(res.status, "foreign story on a valid event must fail closed with 403").toBe(403);
  });

  // FALSE-POSITIVE — an UNKNOWN event type must NOT be accepted as a valid dispatch.
  // VALID_EVENTS = {session_start, prompt_submit, pre_tool, post_tool, stop}
  // (dirigent-supervisor.ts:34-40). LIVE-GREEN today — guards against the
  // validation regressing into silent acceptance (§20 "neznámý event type nespadne").
  it("LIVE false-positive: an unknown event type must NOT be accepted (400 invalid_event)", async () => {
    if (!JWT_A) return;
    const res = await dispatch(JWT_A, { event: "definitely_not_a_real_event", story_id: storyA });
    if (!res) return;
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error?: string; valid?: string[] };
    expect(body.error).toBe("invalid_event");
    expect(body.valid).toEqual(
      expect.arrayContaining(["session_start", "prompt_submit", "pre_tool", "post_tool", "stop"]),
    );
  });
});

// POST /chat carries the SAME cross-tenant hole: resolveChatStoryId returns the
// caller-supplied body.story_id verbatim with NO ownership check. The route-layer
// rejection must be enforced on BOTH ingresses by the shared resolveAndValidateStoryId.
async function chat(jwt: string, body: unknown): Promise<Response | null> {
  try {
    return await fetch(`${BASE.replace(/\/$/, "")}/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${jwt}` },
      body: JSON.stringify(body),
    });
  } catch {
    return null; // service not running in this env → skip body
  }
}

d("story-resolver-hole · POST /chat ownership (§19.1, LIVE)", () => {
  it("LIVE-RED negative: /chat with a foreign body.story_id → 403 fail-closed (route-layer ownership)", async () => {
    if (!JWT_B) return; // requires a real tenant-B JWT
    const res = await chat(JWT_B, { story_id: storyA, message: "ping" });
    if (!res) return; // service down → skip
    expect(res.status, "foreign story on /chat must fail closed with 403").toBe(403);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// SKIP-UNTIL-IMPL — the future shared resolver + PAT story binding + NOT NULL
// invariant. These surfaces do NOT exist yet → NO top-level import of any
// non-existent module. Each block carries the exact contract it must satisfy.
// ─────────────────────────────────────────────────────────────────────────────
describe.skip("story-resolver-hole · resolveAndValidateStoryId (NOT IMPLEMENTED — §19.1, §20 P1 #12)", () => {
  // CONTRACT (future shared module; spec: "jeden sdílený
  // resolveAndValidateStoryId(userId, explicitStoryId?, pgrest)" wired into BOTH
  // POST /dirigent/dispatch AND POST /story-consult — dirigent-dispatch-shared-resolver):
  //   1. explicit owned story            → returns it.
  //   2. explicit foreign story          → THROWS (fail-closed, cross-tenant rejected).
  //   3. null + exactly one owned active → that story.
  //   4. null + owns nothing             → THROWS (NO arbitrary-active fallback — BUG B fix).
  //   5. SAME function backs /dirigent/dispatch and /story-consult (no rule drift).
  // When implemented, use a DYNAMIC import inside the un-skipped block so the file
  // still type-checks while the module is absent:
  //   const { resolveAndValidateStoryId } = await import("@/.../resolveAndValidateStoryId");
  it.todo("positive: explicit owned story resolves");
  it.todo("negative: explicit foreign story throws (fail-closed)");
  it.todo("false-positive: null story + story-less user throws (no arbitrary-active fallback)");
  it.todo("consolidation: /dirigent/dispatch and /story-consult call the same resolver");
});

describe.skip("story-resolver-hole · PAT story binding derives story on /v1/chat/completions (NOT IMPLEMENTED — §8.5, §4.6)", () => {
  // CONTRACT (BLOCKER before Phase A, §8.5 / §20 P0 #3):
  //   - mcp_auth_tokens gains user_id FK + scoped_to_story_id (non-null) + scope text[].
  //     (Today mcp_auth_tokens has NEITHER — aisha/db/sql/tables/mcp_auth_tokens.sql.)
  //   - validate_mcp_token returns { user_id, story_id } for enforcement.
  //   - POST /v1/chat/completions derives story_id from the PAT and IGNORES any
  //     body.story_id (silent override — false-positive: a body-supplied
  //     cross-tenant story_id must NOT be honored). sec-resolver-ownership-false-positive.
  //   - PAT scoped_to_story_id=A dispatching against story B → 403 {"error":"story_mismatch"}.
  //   - Unscoped/legacy PAT (scoped_to_story_id NULL) → fail-closed; no "first
  //     active story" inference.  - Resulting ai_runs.story_id always non-null.
  // /v1/chat/completions does NOT exist yet (§19 "Omni /v1 v kódu NEEXISTUJE").
  // When built, assert at the HTTP layer (Bearer mcp_<token>) — do NOT import.
  it.todo("positive: story_id derived from PAT scope (ai_runs.story_id non-null)");
  it.todo("false-positive: body.story_id ignored when PAT is story-scoped (silent override)");
  it.todo("negative: PAT scoped to story A dispatching story B → 403 story_mismatch");
  it.todo("false-positive: unscoped/legacy PAT fails-closed (no first-active-story inference)");
});
