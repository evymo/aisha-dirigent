/**
 * Trasa odečte zakázané nástroje agentů (SELF_IMPROVEMENT_LOOP.md §3b, K-36).
 *
 * ⛔ NAMĚŘENO 2026-10-01 na main 8640db9ac: route_task slučoval do `tools_allowlist`
 * jen `agent_catalog.allowed_tools`; `denied_tools` nečetl nikdo za běhu — agent tak dostal
 * nástroj, který mu katalog zakazuje. Teď zákaz kteréhokoli agenta trasy vyhrává nad
 * povolením a trasa ho vrací jako `tools_denylist` (executor svc-ai-chat ho vynucuje).
 *
 * Agenty volí rozhodovací strom (fallback CASE), proto test nejdřív změří, koho trasa
 * vybere, a jen těm dočasně nastaví povolené/zakázané nástroje (pak vrátí původní).
 *
 * Spouští se přes: npm run test:db:zakazane-nastroje (throwaway DB z baseline + heals + seed)
 */
import { execFileSync } from "node:child_process";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PG_HOST, PG_PORT, PG_USER, PG_PASSWORD, PG_DATABASE, isPgReachable } from "./test-env-probe";

const DB_SLIBENA = Boolean(process.env.AISHA_DB_URL);

function psql(sql: string): string {
  return execFileSync(
    "psql",
    ["-h", PG_HOST, "-p", PG_PORT, "-U", PG_USER, "-d", PG_DATABASE, "-v", "ON_ERROR_STOP=1", "-tA"],
    {
      input: `\\o /dev/null\nSET request.jwt.claims = '{"role":"service_role"}';\n\\o\n${sql};`,
      encoding: "utf-8",
      env: { ...process.env, PGPASSWORD: PG_PASSWORD },
      stdio: ["pipe", "pipe", "pipe"],
    },
  ).trim();
}

type Plan = { run_id: string; agents: Array<{ slug: string }>; tools_allowlist: string[] | null; tools_denylist: string[] };
const trasa = (): Plan =>
  JSON.parse(psql(`SELECT public.route_task('project_delivery', 'low', '{}'::text[], '{}'::text[], NULL, '{}'::jsonb)::text`)) as Plan;

describe.skipIf(!isPgReachable() && !DB_SLIBENA)("route_task odečte zakázané nástroje agentů (K-36)", () => {
  let agenti: string[] = [];
  const puvodni = new Map<string, { allowed: string; denied: string }>();
  let plan: Plan;

  beforeAll(() => {
    if (!isPgReachable()) {
      throw new Error("AISHA_DB_URL je nastavená, ale DB nejde dosáhnout — sonda NESMÍ skončit přeskočením");
    }
    agenti = trasa().agents.map((a) => a.slug);
    if (agenti.length === 0) throw new Error("route_task nevybral žádného agenta — test by měřil prázdno");
    for (const slug of agenti) {
      const [allowed, denied] = psql(
        `SELECT allowed_tools::text || '|' || denied_tools::text FROM public.agent_catalog WHERE slug = '${slug}'`,
      ).split("|");
      puvodni.set(slug, { allowed, denied });
    }
    const prvni = agenti[0];
    const posledni = agenti[agenti.length - 1];
    // první agent povoluje k36_a i k36_b; poslední (může být týž) zakazuje k36_b
    psql(`UPDATE public.agent_catalog SET allowed_tools = ARRAY['k36_a','k36_b'] WHERE slug = '${prvni}'`);
    psql(`UPDATE public.agent_catalog SET denied_tools = ARRAY['k36_b'] WHERE slug = '${posledni}'`);
    plan = trasa();
  });

  afterAll(() => {
    if (!isPgReachable()) return;
    for (const [slug, v] of puvodni) {
      psql(`UPDATE public.agent_catalog SET allowed_tools = '${v.allowed}'::text[], denied_tools = '${v.denied}'::text[] WHERE slug = '${slug}'`);
    }
  });

  it("povolený nástroj zůstane (kontrolní vzorek)", () => {
    expect(plan.tools_allowlist ?? []).toContain("k36_a");
  });

  it("zakázaný nástroj z povolených vypadne a je v tools_denylist", () => {
    expect(plan.tools_allowlist ?? []).not.toContain("k36_b");
    expect(plan.tools_denylist).toContain("k36_b");
  });

  it("totéž nese uložený plán běhu (ai_runs.route_plan)", () => {
    const ulozeny = JSON.parse(psql(`SELECT route_plan::text FROM public.ai_runs WHERE id = '${plan.run_id}'`)) as {
      tools_allowlist: string[] | null;
      tools_denylist: string[];
    };
    expect(ulozeny.tools_allowlist ?? []).not.toContain("k36_b");
    expect(ulozeny.tools_denylist).toContain("k36_b");
  });
});
