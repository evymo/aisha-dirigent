/**
 * AISHA Omni — Acceptance: Orchestration-Decision matrix (the master plan's #1 finalization proof)
 * Area: orchestration-acceptance  ·  Kind: integration (LIVE dev backend)
 * Spec source of truth: docs/orchestration/AISHA_FINALIZATION_MASTER_PLAN.md
 *   "PROOF — Orchestration-Decision Test Harness": AISHA dynamically picks model + executor for a
 *   task across ALL serviceable providers, with transparent why/how, asserted against the live
 *   resolver on a real dev backend. Nic hardcoded — testujeme dynamické volby, ne fixní matici.
 *
 * RELATIONSHIP TO THE pgTAP:
 *  - aisha/db/tests/schema/12_orchestration_decision_matrix.sql proves the decision LOGIC
 *    deterministically with a synthetic provider set (locally green, every cold-start).
 *  - THIS suite proves the SAME logic against the REAL discovered population (live keys via
 *    Fáze-1A discovery) — generic assertions (winner ∈ serviceable; embedding⇒embedding model)
 *    + prerequisite guards (skip-with-log when the live backend lacks a prerequisite, e.g. <2
 *    serviceable providers or no local backend). Run by the OWNER on a dev backend.
 *
 * ISOLATION (per suite convention):
 *  - Lives under src/tests/omni-acceptance/**\/*.omni.spec.ts; runs ONLY via
 *    vitest.omni-acceptance.config.ts. The default vitest.config.ts EXCLUDES this path.
 *  - Self-skips unless process.env.OMNI_ACCEPTANCE is set, AND unless a DB URL is provided and
 *    `pg` loads — so a normal CI run can never go red here.
 *
 * RUN:
 *   OMNI_ACCEPTANCE=1 AISHA_DB_URL=postgres://…  npx vitest run \
 *     --config vitest.omni-acceptance.config.ts src/tests/omni-acceptance/orchestration-acceptance
 *   (DB URL = a role that may SET ROLE service_role; the resolver is SECURITY DEFINER and gates on
 *    current_setting('role')='service_role'.)
 *
 * The suite also AGGREGATES a decision-report (winner + reasoning + top scores per scenario) to
 * stdout — the master plan's tuning-loop input (which weights/thresholds to ladit).
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";

const ACCEPTANCE = Boolean(process.env.OMNI_ACCEPTANCE);
const d = ACCEPTANCE ? describe : describe.skip;
const DB_URL = process.env.AISHA_DB_URL || process.env.DATABASE_URL || "";

type Row = Record<string, unknown>;
type Pool = {
  connect: () => Promise<{
    query: (sql: string, params?: unknown[]) => Promise<{ rows: Row[] }>;
    release: () => void;
  }>;
  end: () => Promise<void>;
};
let pool: Pool | null = null;

beforeAll(async () => {
  if (!ACCEPTANCE || !DB_URL) return;
  try {
    const pgMod = (await import("pg")) as unknown as {
      Pool: new (cfg: { connectionString: string }) => Pool;
    };
    pool = new pgMod.Pool({ connectionString: DB_URL });
  } catch {
    pool = null;
  }
});

afterAll(async () => {
  if (pool) await pool.end().catch(() => {});
});

type Decision = {
  resolved: boolean;
  top?: { provider_slug?: string; model_id?: string; backend_kind?: string; score?: string };
  candidates?: Array<{ provider_slug?: string; score?: string }>;
  reasoning?: string;
};

/**
 * Resolve on a DEDICATED client with SET ROLE service_role (the resolver's auth gate). RESET +
 * release afterwards so the pooled connection is clean for the next caller.
 */
async function resolveLive(clow: Record<string, unknown>, ctx: Record<string, unknown>): Promise<Decision> {
  if (!pool) throw new Error("__SKIP_NO_DB__");
  const client = await pool.connect();
  try {
    await client.query("SET ROLE service_role");
    const { rows } = await client.query(
      "SELECT public.aisha_resolve_clow_backend($1::jsonb, $2::jsonb) AS res",
      [JSON.stringify(clow), JSON.stringify(ctx)],
    );
    return rows[0].res as Decision;
  } finally {
    await client.query("RESET ROLE").catch(() => {});
    client.release();
  }
}

/** Live serviceable population (enabled + healthy, base/global scope), with capability shape. */
async function liveProviders(): Promise<
  Array<{ slug: string; backend_kind: string; has_chat: boolean; has_embed: boolean }>
> {
  if (!pool) throw new Error("__SKIP_NO_DB__");
  const client = await pool.connect();
  try {
    const { rows } = await client.query(`
      SELECT p.slug, p.backend_kind,
             bool_or(r.is_chat_capable AND NOT r.is_embedding AND r.is_available AND NOT r.is_deprecated) AS has_chat,
             bool_or(r.is_embedding AND r.is_available AND NOT r.is_deprecated)                            AS has_embed
        FROM public.ai_provider_registry p
        JOIN public.ai_model_registry r ON (r.provider_registry_id = p.id OR r.provider = p.slug)
       WHERE p.is_enabled AND p.last_health_status IN ('healthy','unknown')
         AND p.scoped_to_instance_id IS NULL
       GROUP BY p.slug, p.backend_kind`);
    return rows as Array<{ slug: string; backend_kind: string; has_chat: boolean; has_embed: boolean }>;
  } finally {
    client.release();
  }
}

function skipUnlessDb(): boolean {
  if (!pool) {
    console.warn("[orchestration-acceptance] SKIP — no AISHA_DB_URL / pg; run with a live dev backend.");
    return true;
  }
  return false;
}

const report: string[] = [];
function record(scenario: string, dvn: Decision): void {
  const top = dvn.top;
  report.push(
    `  • ${scenario}: ${dvn.resolved ? `${top?.provider_slug}/${top?.model_id} (score=${top?.score})` : "resolved=false"}` +
      (dvn.reasoning ? `\n      ${dvn.reasoning}` : ""),
  );
}

// ═════════════════════════════════════════════════════════════════════════════
d("orchestration-acceptance · decision matrix (LIVE resolver, real providers)", () => {
  // 1. DYNAMISM — the central proof. Same chat task, different serviceable_slugs ⇒ each winner is
  //    drawn from the serviceable set (and, when ≥2 distinct chat providers exist, demonstrably
  //    different). No hardcoded matrix could satisfy both.
  it("(1) same task × different serviceable_slugs → winner tracks the serviceable set (dynamic)", async () => {
    if (skipUnlessDb()) return;
    const chat = (await liveProviders()).filter((p) => p.has_chat);
    if (chat.length < 1) {
      console.warn("[orchestration-acceptance] SKIP (1) — no chat-capable serviceable provider live.");
      return;
    }
    const clow = { purpose: "acceptance", task_kind: "chat" };
    // each single-provider serviceable set must resolve INTO that set
    for (const p of chat.slice(0, 3)) {
      const dvn = await resolveLive(clow, { serviceable_slugs: [p.slug] });
      record(`dynamism[${p.slug}]`, dvn);
      expect(dvn.resolved, `serviceable=[${p.slug}] should resolve`).toBe(true);
      expect(dvn.top?.provider_slug, `winner must be the only serviceable provider`).toBe(p.slug);
    }
    // with ≥2 distinct chat providers, different serviceable ⇒ different winner.
    if (chat.length >= 2) {
      const a = await resolveLive(clow, { serviceable_slugs: [chat[0].slug] });
      const b = await resolveLive(clow, { serviceable_slugs: [chat[1].slug] });
      expect(a.top?.provider_slug).not.toBe(b.top?.provider_slug);
    }
  });

  // 2. CAPABILITY — an embedding task resolves to an embedding model (the embedding-capability gate),
  //    never a chat model. Skip-with-log if the live backend has no embedding model.
  it("(2) task_kind=embedding → an is_embedding model (capability gate)", async () => {
    if (skipUnlessDb()) return;
    const embed = (await liveProviders()).filter((p) => p.has_embed);
    if (embed.length < 1) {
      console.warn("[orchestration-acceptance] SKIP (2) — no embedding model live (run /embeddings backfill).");
      return;
    }
    const dvn = await resolveLive(
      { purpose: "acceptance", task_kind: "embedding" },
      { serviceable_slugs: embed.map((p) => p.slug) },
    );
    record("embedding", dvn);
    expect(dvn.resolved).toBe(true);
    // the chosen provider must be one that actually has an embedding model
    expect(embed.map((p) => p.slug)).toContain(dvn.top?.provider_slug);
  });

  // 3. RESIDENCY — cloud_forbidden=true ⇒ ONLY on-prem backends eligible (cloud reaches zero).
  //    Skip-with-log if no local backend is live.
  it("(3) cloud_forbidden=true → only a local backend wins (residency hard-filter)", async () => {
    if (skipUnlessDb()) return;
    const provs = await liveProviders();
    const local = provs.filter((p) => p.backend_kind === "local_ollama" || p.backend_kind === "local_vllm");
    if (local.length < 1) {
      console.warn("[orchestration-acceptance] SKIP (3) — no local backend live (on-prem residency untestable).");
      return;
    }
    const dvn = await resolveLive(
      { purpose: "acceptance", task_kind: "chat", cloud_forbidden: true },
      { serviceable_slugs: provs.map((p) => p.slug) },
    );
    record("residency", dvn);
    expect(dvn.resolved).toBe(true);
    expect(["local_ollama", "local_vllm"]).toContain(dvn.top?.backend_kind);
  });

  // 4. NO-SUBSTITUTION (fail loud) — a serviceable set naming only a non-existent provider must
  //    return resolved=false. Proves the resolver does NOT mask an empty set with a hardcoded fallback.
  it("(4) serviceable=[nonexistent] → resolved=false (no hardcoded fallback)", async () => {
    if (skipUnlessDb()) return;
    const dvn = await resolveLive(
      { purpose: "acceptance", task_kind: "chat" },
      { serviceable_slugs: ["__no_such_provider__"] },
    );
    record("no-substitution", dvn);
    expect(dvn.resolved).toBe(false);
  });

  // 5. TRANSPARENCY — every resolved decision carries reasoning + a scored candidate list (the
  //    tuning-loop substrate). Also flushes the aggregated decision-report to stdout.
  it("(5) a resolved decision is transparent (reasoning + scored candidates)", async () => {
    if (skipUnlessDb()) return;
    const provs = (await liveProviders()).filter((p) => p.has_chat);
    if (provs.length < 1) {
      console.warn("[orchestration-acceptance] SKIP (5) — no chat-capable serviceable provider live.");
      return;
    }
    const dvn = await resolveLive(
      { purpose: "acceptance", task_kind: "chat" },
      { serviceable_slugs: provs.map((p) => p.slug) },
    );
    record("transparency", dvn);
    expect(dvn.resolved).toBe(true);
    expect(typeof dvn.reasoning).toBe("string");
    expect(Array.isArray(dvn.candidates) && dvn.candidates.length >= 1).toBe(true);
    console.log("\n[orchestration-acceptance] DECISION REPORT\n" + report.join("\n") + "\n");
  });
});
