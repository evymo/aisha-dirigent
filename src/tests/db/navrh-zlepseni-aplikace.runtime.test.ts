/**
 * Schválení návrhu zlepšení hlásí „applied" jen po SKUTEČNÉ změně (SELF_IMPROVEMENT_LOOP.md §3, K-05).
 *
 * ⛔ NAMĚŘENO 2026-09-28 na main 9087ef3df: fn_create_improvement_proposal nenastaví
 * proposal_type ani proposed_value. approve_improvement_proposal_admin(p_auto_apply=true)
 * pak prošel `CASE … ELSE NULL` a přesto zapsal status 'applied' a vrátil 'applied' —
 * „aplikováno" bez jediné změny. Outcome review a rollback pak pracovaly se změnou,
 * která nikdy nenastala.
 *
 * Co se tu měří (pod správcem, přes skutečné granty):
 *   1. model_change s novým modelem → applied + agent změněn + snapshot  ← kontrolní vzorek
 *   2. typ NULL → approved, not_applied_reason = type_not_auto_appliable, agent beze změny
 *   3. model_change bez účinku → approved, no_effective_change
 *   4. tool_config_change → applied, allowed_tools změněny
 *   5. bez p_auto_apply → approved (schválení bez aplikace dál funguje)
 *
 * Spouští se přes: npm run test:db:navrh-aplikace (throwaway DB z baseline + heals + seed)
 */
import { randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PG_HOST, PG_PORT, PG_USER, PG_PASSWORD, PG_DATABASE, isPgReachable } from "./test-env-probe";

const RUN = randomUUID().slice(0, 8);
const ADMIN = randomUUID();
const AGENT = `navrh-${RUN}`;

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

type Vysledek = { status: string; auto_applied: boolean; not_applied_reason: string | null };

function navrh(typ: string | null, navrzeno: Record<string, unknown>): string {
  const id = randomUUID();
  svc(`INSERT INTO public.improvement_proposals (id, agent_slug, title, description, status, proposal_type, proposed_value)
       VALUES ('${id}', '${AGENT}', 'k05 ${RUN}', 'k05', 'pending', ${typ === null ? "NULL" : `'${typ}'`},
               '${JSON.stringify(navrzeno)}'::jsonb)`);
  return id;
}

function schval(id: string, autoApply: boolean): Vysledek {
  const out = psql(
    `{"sub":"${ADMIN}","role":"authenticated"}`,
    `SELECT public.approve_improvement_proposal_admin(${autoApply}, '${id}', 'k05')::text`,
    "authenticated",
  );
  return JSON.parse(out) as Vysledek;
}

const stavNavrhu = (id: string) => svc(`SELECT status FROM public.improvement_proposals WHERE id = '${id}'`);
const modelAgenta = () => svc(`SELECT default_model FROM public.agent_catalog WHERE slug = '${AGENT}'`);

describe.skipIf(!isPgReachable() && !DB_SLIBENA)("schválení návrhu hlásí applied jen po skutečné změně (K-05)", () => {
  beforeAll(() => {
    if (!isPgReachable()) {
      throw new Error("AISHA_DB_URL je nastavená, ale DB nejde dosáhnout — sonda NESMÍ skončit přeskočením");
    }
    svc(`INSERT INTO aisha_auth.users (id, email) VALUES ('${ADMIN}', 'navrh-admin-${RUN}@test.local') ON CONFLICT (id) DO NOTHING`);
    svc(`INSERT INTO public.roles (name, display_name, is_admin) VALUES ('admin', 'Administrator', true) ON CONFLICT (name) DO NOTHING`);
    svc(`INSERT INTO public.user_roles (user_id, role) VALUES ('${ADMIN}', 'admin') ON CONFLICT DO NOTHING`);
    svc(`INSERT INTO public.agent_catalog (slug, display_name, purpose, default_model, allowed_tools)
         VALUES ('${AGENT}', 'K05', 'k05', 'model-puvodni', ARRAY['a'])`);
  });

  afterAll(() => {
    if (!isPgReachable()) return;
    svc(`DELETE FROM public.improvement_proposals WHERE agent_slug = '${AGENT}'`);
    svc(`DELETE FROM public.agent_catalog WHERE slug = '${AGENT}'`);
    svc(`DELETE FROM public.user_roles WHERE user_id = '${ADMIN}'`);
  });

  it("model_change s novým modelem → applied, agent změněn, snapshot uložen (kontrolní vzorek)", () => {
    const id = navrh("model_change", { default_model: "model-novy" });
    const v = schval(id, true);
    expect(v).toMatchObject({ status: "applied", auto_applied: true, not_applied_reason: null });
    expect(stavNavrhu(id)).toBe("applied");
    expect(modelAgenta()).toBe("model-novy");
    expect(svc(`SELECT current_value->>'default_model' FROM public.improvement_proposals WHERE id = '${id}'`)).toBe("model-puvodni");
  });

  it("typ NULL (tak ho zakládá fn_create_improvement_proposal) → approved, nic se nezmění", () => {
    const pred = modelAgenta();
    const id = navrh(null, { default_model: "model-jiny" });
    const v = schval(id, true);
    expect(v).toMatchObject({ status: "approved", auto_applied: false, not_applied_reason: "type_not_auto_appliable" });
    expect(stavNavrhu(id)).toBe("approved");
    expect(modelAgenta()).toBe(pred);
  });

  it("model_change bez účinku → approved, no_effective_change", () => {
    const id = navrh("model_change", {});
    const v = schval(id, true);
    expect(v).toMatchObject({ status: "approved", auto_applied: false, not_applied_reason: "no_effective_change" });
    expect(stavNavrhu(id)).toBe("approved");
  });

  it("tool_config_change → applied, allowed_tools změněny", () => {
    const id = navrh("tool_config_change", { allowed_tools: ["a", "b"] });
    expect(schval(id, true).status).toBe("applied");
    expect(svc(`SELECT array_to_string(allowed_tools, ',') FROM public.agent_catalog WHERE slug = '${AGENT}'`)).toBe("a,b");
  });

  it("bez auto-apply → approved, bez důvodu neaplikace", () => {
    const id = navrh("model_change", { default_model: "model-zadny" });
    expect(schval(id, false)).toMatchObject({ status: "approved", auto_applied: false, not_applied_reason: null });
  });
});
