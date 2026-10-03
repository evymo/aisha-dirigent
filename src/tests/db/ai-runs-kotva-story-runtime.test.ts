import { beforeAll, describe, expect, it } from "vitest";
import { psqlMultiline, psqlQuery } from "./validation-utils";
import { isPgReachable, reportTestCapabilities } from "./test-env-probe";

/**
 * Kotva běhu ke story: běh bez story dostane stack-default story — pro KAŽDÉHO
 * oprávněného zapisovatele, ne jen pro správu.
 *
 * ⛔ NAMĚŘENO 2026-09-27 na čistém mainu: trigger ai_runs_default_story volal
 * `ensure_stack_default_story()` (guard „admin/staff nebo service_role" nad claims
 * VOLAJÍCÍHO) a od totálních guardů (2026-08-04) odmítl běžného přihlášeného
 * zapisovatele: `route_task` (grant pro authenticated) padal na „Unauthorized".
 * Na ai_runs navíc ležely DVA triggery téhož účelu.
 *
 * Měří se nad skutečnou DB: jeden kotvicí trigger, zápis pod běžnou identitou
 * projde a běh nese stack-default story, výslovná story se nepřepíše.
 */
const dbAvailable = isPgReachable();
const HEADER = "\\set ON_ERROR_STOP on\n";
const BEZNY = "80808080-8080-4808-8808-808080808080";

const dotaz = (sql: string) =>
  psqlQuery(`SELECT set_config('request.jwt.claims', '{"role":"service_role"}', true) IS NOT NULL AND true; ${sql}`)
    .trim()
    .split("\n")
    .pop() ?? "";

/** Volání pod BĚŽNÝM přihlášeným uživatelem (bez role správy); transakce se potvrdí. */
const jako = (sub: string, sql: string): string => {
  const vystup = psqlMultiline(`${HEADER}BEGIN;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', '{"role":"authenticated","sub":"${sub}"}', true);
SELECT 'vysledek=' || (${sql})::text;
COMMIT;`);
  const radek = vystup.split("\n").find((r) => r.includes("vysledek="));
  return radek ? radek.slice(radek.indexOf("vysledek=") + "vysledek=".length).trim() : "";
};

beforeAll(async () => {
  await reportTestCapabilities("kotva běhu ke story");
  if (!dbAvailable) return;
  psqlMultiline(`${HEADER}
INSERT INTO aisha_auth.users (id, email) VALUES ('${BEZNY}', 'kotva-bezny@test.local') ON CONFLICT DO NOTHING;
INSERT INTO public.profiles (user_id, email) VALUES ('${BEZNY}', 'kotva-bezny@test.local') ON CONFLICT (user_id) DO NOTHING;
DELETE FROM public.user_roles WHERE user_id = '${BEZNY}';`);
});

describe("kotva běhu ke story", () => {
  it.skipIf(!dbAvailable)("na ai_runs je JEDEN kotvicí trigger (dřív dva téhož účelu)", () => {
    const triggery = dotaz(`SELECT string_agg(t.tgname, ',' ORDER BY t.tgname) FROM pg_trigger t
                             JOIN pg_proc p ON p.oid = t.tgfoid
                            WHERE t.tgrelid = 'public.ai_runs'::regclass AND NOT t.tgisinternal
                              AND p.proname LIKE 'fn_ai_runs_default%';`);
    expect(triggery).toBe("ai_runs_default_story");
  });

  it.skipIf(!dbAvailable)("běžný přihlášený uživatel zapíše běh bez story (route_task) a běh nese stack-default story", () => {
    const stackDefault = dotaz(`SELECT id FROM public.partner_stories WHERE is_stack_default LIMIT 1;`);
    expect(stackDefault, "seed musí singleton založit — jinak test měří prázdno").toMatch(/^[0-9a-f-]{36}$/);

    const plan = JSON.parse(jako(BEZNY, `public.route_task('chat', 'low', '{}'::text[], '{}'::text[], NULL, '{}'::jsonb)`));
    const runId = plan.run_id ?? plan.ai_run_id ?? plan.id;
    expect(runId, `route_task nevrátil id běhu: ${JSON.stringify(plan).slice(0, 200)}`).toMatch(/^[0-9a-f-]{36}$/);
    expect(dotaz(`SELECT story_id FROM public.ai_runs WHERE id = '${runId}';`)).toBe(stackDefault);
  });

  it.skipIf(!dbAvailable)("výslovná story se nepřepíše (kotva jen doplňuje NULL)", () => {
    // WITH … RETURNING + SELECT: holé INSERT … RETURNING vypíše za řádkem i stav „INSERT 0 1"
    // a pomocník bere POSLEDNÍ řádek výstupu.
    const vlastni = dotaz(`WITH s AS (INSERT INTO public.partner_stories (title) VALUES ('ZZ kotva vlastni') RETURNING id) SELECT id FROM s;`);
    expect(vlastni).toMatch(/^[0-9a-f-]{36}$/);
    const run = dotaz(`WITH r AS (INSERT INTO public.ai_runs (kind, story_id, status) VALUES ('chat', '${vlastni}', 'running') RETURNING story_id) SELECT story_id FROM r;`);
    expect(run).toBe(vlastni);
    psqlMultiline(`${HEADER}DELETE FROM public.ai_runs WHERE story_id = '${vlastni}'; DELETE FROM public.partner_stories WHERE id = '${vlastni}';`);
  });
});
