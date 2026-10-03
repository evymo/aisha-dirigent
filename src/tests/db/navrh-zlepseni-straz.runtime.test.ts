/**
 * Návrh zlepšení smí založit jen služba nebo správa (SELF_IMPROVEMENT_LOOP.md §3, K-15).
 *
 * ⛔ NAMĚŘENO 2026-09-28/29 na main 9087ef3df: fn_create_improvement_proposal je
 * SECURITY DEFINER s grantem `authenticated` a bez vlastní stráže. Zápis návrhu
 * cizím zastavilo jen NÁHODOU vnitřní volání ensure_stack_default_story() (má
 * vlastní stráž) — ale až PO kontrole agenta a duplicity. Cizí přihlášený tak
 * dostal orákulum: „Unknown agent" prozradí, který agent existuje, a známý
 * anomaly_key vrátil `{error: duplicate, existing_proposal_id}` — ID cizího
 * návrhu. Stráž je teď první příkaz funkce.
 *
 * Co se tu měří:
 *   1. služba (n8n, runner) návrh založí                        ← kontrolní vzorek
 *   2. správce (admin UI) návrh založí                           ← kontrolní vzorek
 *   3. cizí přihlášený → 42501, nic nevznikne
 *   4. cizí se nedozví ID existujícího návrhu ani existenci agenta (orákulum)
 *   5. anonym → bez grantu
 *
 * Spouští se přes: npm run test:db:navrh-straz (throwaway DB z baseline + heals + seed)
 */
import { randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PG_HOST, PG_PORT, PG_USER, PG_PASSWORD, PG_DATABASE, isPgReachable } from "./test-env-probe";

const RUN = randomUUID().slice(0, 8);
const ADMIN = randomUUID();
const CIZI = randomUUID();
const AGENT = `straz-${RUN}`;

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

/** Volání pod danou identitou; každý návrh jiným anomaly_key (dedup) a pod limitem 3/h. */
function zaloz(claims: string, role: string | undefined, klic: string): { ok: true; out: string } | { ok: false; err: string } {
  try {
    const out = psql(
      claims,
      `SELECT public.fn_create_improvement_proposal('${AGENT}', 'general', 'k15', jsonb_build_object('anomaly_key', 'k15-${RUN}-${klic}'), 'k15 ${klic}')::text`,
      role,
    );
    return { ok: true, out };
  } catch (e) {
    return { ok: false, err: String((e as { stderr?: string }).stderr ?? e) };
  }
}

const pocetNavrhu = () => Number(svc(`SELECT count(*) FROM public.improvement_proposals WHERE agent_slug = '${AGENT}'`));

describe.skipIf(!isPgReachable() && !DB_SLIBENA)("návrh zlepšení zakládá jen služba nebo správa (K-15)", () => {
  beforeAll(() => {
    if (!isPgReachable()) {
      throw new Error("AISHA_DB_URL je nastavená, ale DB nejde dosáhnout — sonda NESMÍ skončit přeskočením");
    }
    svc(`INSERT INTO aisha_auth.users (id, email) VALUES
           ('${ADMIN}', 'straz-admin-${RUN}@test.local'),
           ('${CIZI}',  'straz-cizi-${RUN}@test.local')
         ON CONFLICT (id) DO NOTHING`);
    svc(`INSERT INTO public.roles (name, display_name, is_admin) VALUES ('admin', 'Administrator', true) ON CONFLICT (name) DO NOTHING`);
    svc(`INSERT INTO public.user_roles (user_id, role) VALUES ('${ADMIN}', 'admin') ON CONFLICT DO NOTHING`);
    svc(`INSERT INTO public.agent_catalog (slug, display_name, purpose, default_model, autonomy_level)
         VALUES ('${AGENT}', 'K15', 'k15', 'test-model', 'full')`);
  });

  afterAll(() => {
    if (!isPgReachable()) return;
    svc(`DELETE FROM public.improvement_proposals WHERE agent_slug = '${AGENT}'`);
    svc(`DELETE FROM public.agent_catalog WHERE slug = '${AGENT}'`);
    svc(`DELETE FROM public.user_roles WHERE user_id = '${ADMIN}'`);
  });

  it("služba návrh založí (kontrolní vzorek)", () => {
    const r = zaloz('{"role":"service_role"}', undefined, "sluzba");
    expect(r.ok, r.ok ? "" : r.err).toBe(true);
    expect(r.ok && JSON.parse(r.out).proposal_id).toBeTruthy();
  });

  it("správce návrh založí (kontrolní vzorek)", () => {
    const r = zaloz(`{"sub":"${ADMIN}","role":"authenticated"}`, "authenticated", "admin");
    expect(r.ok, r.ok ? "" : r.err).toBe(true);
  });

  it("cizí přihlášený → 42501 a nic nevznikne", () => {
    const pred = pocetNavrhu();
    const r = zaloz(`{"sub":"${CIZI}","role":"authenticated"}`, "authenticated", "cizi");
    expect(r.ok).toBe(false);
    expect(!r.ok && r.err).toMatch(/Unauthorized/);
    expect(pocetNavrhu()).toBe(pred);
  });

  it("cizí se nedozví ID existujícího návrhu ani existenci agenta (orákulum)", () => {
    const sluzba = zaloz('{"role":"service_role"}', undefined, "tajny");
    const id = sluzba.ok ? (JSON.parse(sluzba.out).proposal_id as string) : "";
    expect(id, "kontrolní vzorek: služba návrh s klíčem založila").toBeTruthy();

    const duplicita = zaloz(`{"sub":"${CIZI}","role":"authenticated"}`, "authenticated", "tajny");
    expect(duplicita.ok ? duplicita.out : "", "cizí nesmí dostat ID cizího návrhu").not.toContain(id);
    expect(duplicita.ok).toBe(false);

    let neznamy: string;
    try {
      neznamy = psql(
        `{"sub":"${CIZI}","role":"authenticated"}`,
        `SELECT public.fn_create_improvement_proposal('neexistuje-${RUN}', 'general', 'k15', '{}'::jsonb, 'k15')::text`,
        "authenticated",
      );
    } catch (e) {
      neznamy = String((e as { stderr?: string }).stderr ?? e);
    }
    expect(neznamy, "cizí nesmí rozlišit neexistujícího agenta od odepření").not.toMatch(/Unknown agent/);
    expect(neznamy).toMatch(/Unauthorized/);
  });

  it("anonym → bez grantu", () => {
    const r = zaloz('{"role":"anon"}', "anon", "anon");
    expect(r.ok).toBe(false);
    expect(!r.ok && r.err).toMatch(/permission denied/);
  });
});
