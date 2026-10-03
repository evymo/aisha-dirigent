/**
 * Snímek výkonu agenta — CHOVÁNÍ proti živé DB (SELF_IMPROVEMENT_LOOP.md §3, K-01).
 *
 * ⛔ NAMĚŘENO 2026-09-28 na main 9087ef3df: `fn_get_agent_performance_snapshot`
 * spojovala `ai_eval_runs.run_id`, sloupec, který tabulka NEMÁ → každé volání
 * padlo. WF_IMPROVEMENT_EVAL (vyhodnocení změny po 24 h) a WF_MODEL_ADVISORY
 * (týdenní rada k modelu) tak smyčku zlepšování nikdy neuzavřely. Funkce navíc
 * nebyla v heals, vracela neměřenou kvalitu jako 0 (→ falešná regrese a rollback),
 * `total_events` jen zanořený (poradce četl nahoře a viděl vždy 0) a jako
 * SECURITY DEFINER s grantem `authenticated` neměla vlastní stráž.
 *
 * Co se tu měří:
 *   1. kvalita agenta = jen JEHO zlaté příklady, jen DOKONČENÁ hodnocení v okně
 *      (cizí agent ani rozpracované hodnocení průměr nezmění) ← kontrolní vzorek
 *   2. provoz = jen jeho trace události; `total_events` je i nahoře
 *   3. agent bez dat: avg_overall a error_rate jsou NULL, ne 0 (Z3)
 *   4. stráž: služba a správce ano, cizí přihlášený 42501, anonym bez grantu
 *
 * Spouští se přes: npm run test:db:vykon-agenta (throwaway DB z baseline + heals + seed)
 */
import { randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PG_HOST, PG_PORT, PG_USER, PG_PASSWORD, PG_DATABASE, isPgReachable } from "./test-env-probe";

const RUN = randomUUID().slice(0, 8);
const ADMIN = randomUUID();
const CIZI = randomUUID();
const STORY = randomUUID();
const BEH = randomUUID();
const AGENT = `vykon-a-${RUN}`;
const SOUSED = `vykon-b-${RUN}`; // jiný agent: jeho data nesmí prosáknout do AGENT
const PRAZDNY = `vykon-c-${RUN}`; // existuje, ale nemá žádná data
const EVAL_HOTOVY = randomUUID();
const EVAL_ROZPRACOVANY = randomUUID();
const EVAL_STARY = randomUUID();
const GOLD_A = randomUUID();
const GOLD_B = randomUUID();

/** Wrapper throwaway DB nastaví AISHA_DB_URL — pak je nedosažitelná DB vada, ne důvod přeskočit. */
const DB_SLIBENA = Boolean(process.env.AISHA_DB_URL);

function psql(claims: string, sql: string, role?: string): string {
  const setRole = role ? `SET ROLE ${role};\n` : "";
  return execFileSync(
    "psql",
    ["-h", PG_HOST, "-p", PG_PORT, "-U", PG_USER, "-d", PG_DATABASE, "-v", "ON_ERROR_STOP=1", "-tA"],
    {
      input: `\\o /dev/null\nSET request.jwt.claims = '${claims}';\n${setRole}\\o\n${sql};`,
      encoding: "utf-8",
      env: { ...process.env, PGPASSWORD: PG_PASSWORD },
      stdio: ["pipe", "pipe", "pipe"],
    },
  ).trim();
}

const svc = (sql: string) => psql('{"role":"service_role"}', sql);

type Snimek = {
  agent_slug: string;
  avg_overall: number | null;
  eval_measured: boolean;
  error_rate: number | null;
  total_events: number;
  eval_metrics: { eval_count?: number; result_count?: number; avg_overall?: number | null };
  trace_metrics: { total_events?: number; error_count?: number };
};

function snimekSluzbou(slug: string, hodiny = 24): Snimek {
  return JSON.parse(svc(`SELECT public.fn_get_agent_performance_snapshot('${slug}', ${hodiny})::text`)) as Snimek;
}

/** Volání pod skutečnou rolí PostgREST (granty i stráž platí). */
function jako(uid: string | null, slug: string): { ok: true; out: Snimek } | { ok: false; err: string } {
  const claims = uid ? `{"sub":"${uid}","role":"authenticated"}` : '{"role":"anon"}';
  try {
    const out = psql(claims, `SELECT public.fn_get_agent_performance_snapshot('${slug}', 24)::text`, uid ? "authenticated" : "anon");
    return { ok: true, out: JSON.parse(out) as Snimek };
  } catch (e) {
    return { ok: false, err: String((e as { stderr?: string }).stderr ?? e) };
  }
}

describe.skipIf(!isPgReachable() && !DB_SLIBENA)("snímek výkonu agenta (K-01)", () => {
  beforeAll(() => {
    if (!isPgReachable()) {
      throw new Error("AISHA_DB_URL je nastavená, ale DB nejde dosáhnout — sonda NESMÍ skončit přeskočením");
    }
    svc(`INSERT INTO aisha_auth.users (id, email) VALUES
           ('${ADMIN}', 'vykon-admin-${RUN}@test.local'),
           ('${CIZI}',  'vykon-cizi-${RUN}@test.local')
         ON CONFLICT (id) DO NOTHING`);
    svc(`INSERT INTO public.roles (name, display_name, is_admin) VALUES ('admin', 'Administrator', true)
         ON CONFLICT (name) DO NOTHING`);
    svc(`INSERT INTO public.user_roles (user_id, role) VALUES ('${ADMIN}', 'admin') ON CONFLICT DO NOTHING`);

    svc(`INSERT INTO public.agent_catalog (slug, display_name, purpose, default_model) VALUES
           ('${AGENT}',   'Výkon A', 'k01', 'test-model'),
           ('${SOUSED}',  'Výkon B', 'k01', 'test-model'),
           ('${PRAZDNY}', 'Výkon C', 'k01', 'test-model')`);

    // Kvalita: zlatý příklad každého agenta; hodnocení dokončené v okně, rozpracované a staré.
    svc(`INSERT INTO public.ai_golden_examples (id, user_message, assistant_message, agent_slug) VALUES
           ('${GOLD_A}', 'q a', 'a a', '${AGENT}'),
           ('${GOLD_B}', 'q b', 'a b', '${SOUSED}')`);
    svc(`INSERT INTO public.ai_eval_runs (id, trigger_type, status, completed_at) VALUES
           ('${EVAL_HOTOVY}',       'manual', 'completed', now() - interval '1 hour'),
           ('${EVAL_ROZPRACOVANY}', 'manual', 'running',   NULL),
           ('${EVAL_STARY}',        'manual', 'completed', now() - interval '5 days')`);
    svc(`INSERT INTO public.ai_eval_results
           (eval_run_id, golden_example_id, relevance_score, groundedness_score, safety_score, coherence_score, overall_score, evaluator_model)
         VALUES
           ('${EVAL_HOTOVY}',       '${GOLD_A}', 0.9, 0.8, 1.0, 0.7, 0.8, 'judge'),
           ('${EVAL_HOTOVY}',       '${GOLD_B}', 0.1, 0.1, 0.1, 0.1, 0.1, 'judge'),
           ('${EVAL_ROZPRACOVANY}', '${GOLD_A}', 0.1, 0.1, 0.1, 0.1, 0.1, 'judge'),
           ('${EVAL_STARY}',        '${GOLD_A}', 0.1, 0.1, 0.1, 0.1, 0.1, 'judge')`);

    // Provoz: 3 události agenta (1 chyba) a 1 souseda.
    svc(`INSERT INTO public.partner_stories (id, user_id, title, status) VALUES ('${STORY}', '${ADMIN}', 'vykon ${RUN}', 'active')`);
    svc(`INSERT INTO public.ai_runs (id, kind, story_id) VALUES ('${BEH}', 'chat', '${STORY}')`);
    svc(`INSERT INTO public.ai_trace_events (run_id, event_type, agent_slug, status, duration_ms, cost_json) VALUES
           ('${BEH}', 'llm_call',  '${AGENT}',  'ok',    100, '{"usd": 0.01}'),
           ('${BEH}', 'tool_call', '${AGENT}',  'ok',    200, NULL),
           ('${BEH}', 'llm_call',  '${AGENT}',  'error', 300, '{"usd": 0.02}'),
           ('${BEH}', 'llm_call',  '${SOUSED}', 'error', 999, '{"usd": 5}')`);
  });

  afterAll(() => {
    if (!isPgReachable()) return;
    svc(`DELETE FROM public.ai_trace_events WHERE run_id = '${BEH}'`);
    svc(`DELETE FROM public.ai_runs WHERE id = '${BEH}'`);
    svc(`DELETE FROM public.partner_stories WHERE id = '${STORY}'`);
    svc(`DELETE FROM public.ai_eval_results WHERE eval_run_id IN ('${EVAL_HOTOVY}', '${EVAL_ROZPRACOVANY}', '${EVAL_STARY}')`);
    svc(`DELETE FROM public.ai_eval_runs WHERE id IN ('${EVAL_HOTOVY}', '${EVAL_ROZPRACOVANY}', '${EVAL_STARY}')`);
    svc(`DELETE FROM public.ai_golden_examples WHERE id IN ('${GOLD_A}', '${GOLD_B}')`);
    svc(`DELETE FROM public.agent_catalog WHERE slug IN ('${AGENT}', '${SOUSED}', '${PRAZDNY}')`);
    svc(`DELETE FROM public.user_roles WHERE user_id = '${ADMIN}'`);
  });

  it("kvalita = jen dokončená hodnocení vlastních zlatých příkladů v okně (kontrolní vzorek)", () => {
    const s = snimekSluzbou(AGENT);
    expect(s.eval_measured).toBe(true);
    expect(s.avg_overall).toBe(0.8);
    expect(s.eval_metrics.eval_count).toBe(1);
    expect(s.eval_metrics.result_count).toBe(1);
  });

  it("provoz = jen vlastní události; total_events i nahoře (čte ho WF_MODEL_ADVISORY)", () => {
    const s = snimekSluzbou(AGENT);
    expect(s.total_events).toBe(3);
    expect(s.trace_metrics.total_events).toBe(3);
    expect(s.trace_metrics.error_count).toBe(1);
    expect(s.error_rate).toBe(0.3333);
  });

  it("agent bez dat: neměřeno je NULL, ne 0 (jinak WF_IMPROVEMENT_EVAL vidí regresi)", () => {
    const s = snimekSluzbou(PRAZDNY);
    expect(s.eval_measured).toBe(false);
    expect(s.avg_overall).toBeNull();
    expect(s.error_rate).toBeNull();
    expect(s.total_events).toBe(0);
  });

  it("okno je poctivé: 240 h zahrne staré hodnocení, 24 h ne", () => {
    expect(snimekSluzbou(AGENT, 240).eval_metrics.result_count).toBe(2);
    expect(snimekSluzbou(AGENT, 24).eval_metrics.result_count).toBe(1);
  });

  it("nesmyslné okno je chyba, ne tichý výsledek", () => {
    expect(() => svc(`SELECT public.fn_get_agent_performance_snapshot('${AGENT}', 0)`)).toThrow(/positive/);
  });

  it("stráž: správce ano (kontrolní vzorek), cizí přihlášený 42501, anonym bez grantu", () => {
    const admin = jako(ADMIN, AGENT);
    expect(admin.ok && admin.out.avg_overall).toBe(0.8);

    const cizi = jako(CIZI, AGENT);
    expect(cizi.ok).toBe(false);
    expect(!cizi.ok && cizi.err).toMatch(/Unauthorized/);

    const anon = jako(null, AGENT);
    expect(anon.ok).toBe(false);
    expect(!anon.ok && anon.err).toMatch(/permission denied/);
  });
});
