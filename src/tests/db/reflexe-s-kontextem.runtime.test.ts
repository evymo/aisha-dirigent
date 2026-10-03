/**
 * Běh reflexe dostane kontext (SELF_IMPROVEMENT_LOOP.md §3, K-26a; rozhodnutí majitele D7).
 *
 * ⛔ NAMĚŘENO 2026-09-29 na main 9087ef3df: výchozí profil běhů reflexe
 * `learnings_enabled` (svc-ai-chat orchestrator.ts, contextLoader.ts, hippocampus.ts)
 * v seedu ani SoT NEBYL. compose_context tak při každém běhu spadl na „Context profile
 * not found", runner chybu jen zalogoval a běh jel úplně bez kontextu — bez pravidel,
 * KB i paměti — a vrstva naučeného se nikdy nevyhledala. Navíc runner neposílal
 * p_requester_id, který compose_context pro story-scoped skládání pod službou vyžaduje.
 *
 * Co se tu měří (pod službou, tak volá runtime reflexe):
 *   1. profil existuje, je aktivní a vrstva `learnings` je zapnutá i zařazená do pořadí
 *   2. služba s žadatelem = vlastník story dostane složený kontext     ← kontrolní vzorek
 *   3. služba BEZ žadatele na story-scoped běh → 42501 (RBAC compose_context drží)
 *
 * Spouští se přes: npm run test:db:reflexe-kontext (throwaway DB z baseline + heals + seed)
 */
import { randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PG_HOST, PG_PORT, PG_USER, PG_PASSWORD, PG_DATABASE, isPgReachable } from "./test-env-probe";

const RUN = randomUUID().slice(0, 8);
const VLASTNIK = randomUUID();
const STORY = randomUUID();
const BEH = randomUUID();
const DB_SLIBENA = Boolean(process.env.AISHA_DB_URL);

function psql(claims: string, sql: string): string {
  return execFileSync(
    "psql",
    ["-h", PG_HOST, "-p", PG_PORT, "-U", PG_USER, "-d", PG_DATABASE, "-v", "ON_ERROR_STOP=1", "-tA"],
    {
      input: `\\o /dev/null\nSET request.jwt.claims = '${claims}';\n\\o\n${sql};`,
      encoding: "utf-8",
      env: { ...process.env, PGPASSWORD: PG_PASSWORD },
      stdio: ["pipe", "pipe", "pipe"],
    },
  ).trim();
}

const svc = (sql: string) => psql('{"role":"service_role"}', sql);

describe.skipIf(!isPgReachable() && !DB_SLIBENA)("běh reflexe dostane kontext (K-26a)", () => {
  beforeAll(() => {
    if (!isPgReachable()) {
      throw new Error("AISHA_DB_URL je nastavená, ale DB nejde dosáhnout — sonda NESMÍ skončit přeskočením");
    }
    svc(`INSERT INTO aisha_auth.users (id, email) VALUES ('${VLASTNIK}', 'reflexe-${RUN}@test.local') ON CONFLICT (id) DO NOTHING`);
    svc(`INSERT INTO public.partner_stories (id, user_id, title, status) VALUES ('${STORY}', '${VLASTNIK}', 'reflexe ${RUN}', 'active')`);
    svc(`INSERT INTO public.ai_runs (id, kind, story_id, actor_user_id) VALUES ('${BEH}', 'reflection', '${STORY}', '${VLASTNIK}')`);
  });

  afterAll(() => {
    if (!isPgReachable()) return;
    svc(`DELETE FROM public.ai_trace_events WHERE run_id = '${BEH}'`);
    svc(`DELETE FROM public.ai_runs WHERE id = '${BEH}'`);
    svc(`DELETE FROM public.partner_stories WHERE id = '${STORY}'`);
  });

  it("profil learnings_enabled existuje, je aktivní a vrstva naučeného je zapnutá i v pořadí", () => {
    const radek = JSON.parse(
      svc(`SELECT row_to_json(t)::text FROM (
             SELECT is_active, (layers->'learnings'->>'enabled')::boolean AS learnings,
                    'learnings' = ANY(priority_order) AS v_poradi, token_budget
             FROM public.context_profiles WHERE slug = 'learnings_enabled') t`) || "null",
    ) as { is_active: boolean; learnings: boolean; v_poradi: boolean; token_budget: number } | null;
    expect(radek, "profil v seedu").not.toBeNull();
    expect(radek).toMatchObject({ is_active: true, learnings: true, v_poradi: true, token_budget: 8000 });
  });

  it("služba se žadatelem = vlastník story dostane složený kontext (kontrolní vzorek)", () => {
    const vysledek = JSON.parse(
      svc(`SELECT public.compose_context('${STORY}', 'learnings_enabled', '${BEH}', 'jak nasadit změnu', 'aisha', '${VLASTNIK}')::text`),
    ) as { profile: string; layers: Record<string, unknown>; profile_layers: Record<string, unknown> };
    expect(vysledek.profile).toBe("learnings_enabled");
    expect(vysledek.layers).toHaveProperty("project_context");
    expect(vysledek.profile_layers).toHaveProperty("learnings");
    // skládání se zapsalo do trace běhu (vrstva paměti ho příště uvidí)
    expect(svc(`SELECT count(*) FROM public.ai_trace_events WHERE run_id = '${BEH}' AND event_type = 'context_compose'`)).toBe("1");
  });

  it("služba bez žadatele na story-scoped běh → 42501 (RBAC compose_context drží)", () => {
    expect(() =>
      svc(`SELECT public.compose_context('${STORY}', 'learnings_enabled', '${BEH}', 'x', 'aisha')`),
    ).toThrow(/p_requester_id required/);
  });
});
