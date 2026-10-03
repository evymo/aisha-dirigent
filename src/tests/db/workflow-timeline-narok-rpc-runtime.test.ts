/**
 * Nárok na časovou osu (`get_workflow_timeline_block`) — kdo co v naraci procesu vidí.
 *
 * ⛔ NAMĚŘENO 2026-09-29 na produkci: funkce ptala nárok PER ŘÁDEK —
 * `workflow_step_visible_to` (SECURITY DEFINER, plpgsql, dynamické SQL) pro každý
 * krok každého běhu. Člen bez role čekal 92–95 s na 0 řádků, a protože funkci smí
 * přímo přes /rpc volat kdokoli přihlášený, byla to DoS páka. Oprava přešla na
 * nárok jako MNOŽINY spočítané jednou (vzor CTE `scope` fronty kroků a věže) —
 * a právě proto tenhle test: ramena teď nepočítá sdílený predikát, ale kopie
 * jeho pravidla, a ta se nesmí rozejít. Do té doby nárok časové osy netestovalo
 * nic.
 *
 * Ramena (1:1 s predikátem při volání bez rozsahu a bez kódu kroku):
 *   přiřazení (`assigned_user_id`) · role (`assigned_role` ∈ role volajícího) ·
 *   POTVRZENÁ vazba účtu na `authorized_twin_id`. Admin/staff vidí vše.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { execFileSync } from "child_process";
import { randomUUID } from "crypto";
import { PG_HOST, PG_PORT, PG_USER, PG_PASSWORD, PG_DATABASE, isPgReachable } from "./test-env-probe";

const dbAvailable = isPgReachable();
const RUN = randomUUID().slice(0, 8);
const TEMPLATE = `Timeline narok ${RUN}`;
const ADMIN = randomUUID();
const DRIVER = randomUUID();
const ROLER = randomUUID();
const ASSIGNEE = randomUUID();
const STRANGER = randomUUID();
const DRIVER_TWIN = randomUUID();
/** Role mimo admin/staff — to rameno nesmí splývat s „vidí vše". */
const ROLE = "practitioner";
/** Víc čerstvých cizích záznamů, než kolik pustí limit: nárok musí stát PŘED limitem. */
const FRESH_DECOYS = 12;
const LIMIT = 10;

function psql(claims: string, sql: string): string {
  return execFileSync(
    "psql",
    ["-h", PG_HOST, "-p", PG_PORT, "-U", PG_USER, "-d", PG_DATABASE, "-v", "ON_ERROR_STOP=1", "-tA"],
    {
      encoding: "utf8",
      input: `\\o /dev/null\nSET request.jwt.claims = '${claims}';\n\\o\n${sql};`,
      env: { ...process.env, PGPASSWORD: PG_PASSWORD },
    },
  ).trim();
}
const svc = (sql: string) => psql('{"role":"service_role"}', sql);

interface Timeline {
  data: { rows: Array<{ id: string; run: string; event: string }> };
}
function timelineAs(uid: string): string[] {
  const t = JSON.parse(
    psql(`{"role":"authenticated","sub":"${uid}"}`,
         `SELECT public.get_workflow_timeline_block('${JSON.stringify({ limit: LIMIT })}'::jsonb)`),
  ) as Timeline;
  return t.data.rows.map((r) => r.run);
}

/** Založí běh a k jeho story jeden záznam narace se zadaným časem. */
function runWithEntry(title: string, subject: string, ageDays: number): void {
  svc(`SELECT public.ensure_workflow_run_for_subject(
         '${TEMPLATE}', '${subject}', '${title}', current_date - ${ageDays}, '{}'::jsonb)`);
  svc(`INSERT INTO public.story_entries (story_id, subject_type, subject_id, entry_type, content, occurred_at)
       SELECT ps.id, 'story', ps.id, 'workflow_milestone', 'E-${title}', now() - interval '${ageDays} days'
         FROM public.partner_stories ps WHERE ps.title = '${title}'`);
}
function stepsOf(title: string): string {
  return `FROM public.production_batches b JOIN public.partner_stories ps ON ps.id = b.story_id
          WHERE s.batch_id = b.id AND ps.title = '${title}'`;
}

beforeAll(() => {
  if (!dbAvailable) return;
  svc(`INSERT INTO public.production_workflow_templates (name, workflow_steps, is_active)
       SELECT '${TEMPLATE}',
              '[{"step_code":"predej","step_name":"Predani","step_order":1}]'::jsonb, true
       WHERE NOT EXISTS (SELECT 1 FROM public.production_workflow_templates WHERE name = '${TEMPLATE}')`);
  svc(`INSERT INTO aisha_auth.users (id, email) VALUES
         ('${ADMIN}','tl-admin-${RUN}@test.local'), ('${DRIVER}','tl-driver-${RUN}@test.local'),
         ('${ROLER}','tl-role-${RUN}@test.local'), ('${ASSIGNEE}','tl-assignee-${RUN}@test.local'),
         ('${STRANGER}','tl-stranger-${RUN}@test.local')
       ON CONFLICT (id) DO NOTHING`);
  svc(`INSERT INTO public.user_roles (user_id, role) VALUES ('${ADMIN}', 'admin'), ('${ROLER}', '${ROLE}')
       ON CONFLICT DO NOTHING`);

  // Vlastní běhy jsou STARÉ, cizí čerstvé a je jich víc než limit.
  runWithEntry(`MUJ-${RUN}`, `tl-${RUN}-mine`, 60);
  runWithEntry(`ROLE-${RUN}`, `tl-${RUN}-role`, 50);
  runWithEntry(`PRIRAZ-${RUN}`, `tl-${RUN}-assigned`, 40);
  for (let i = 0; i < FRESH_DECOYS; i++) runWithEntry(`CIZI-${RUN}-${i}`, `tl-${RUN}-x${i}`, 0);

  // Vazba řidiče: twin + POTVRZENÁ vazba účtu + `authorized_twin_id` na kroku
  // (týž tvar a táž schémová povinnost jako v timing-tower-narok-rpc-runtime).
  svc(`INSERT INTO public.twin_entities (id, entity_type, label)
       VALUES ('${DRIVER_TWIN}', 'driver', 'Ridic ${RUN}') ON CONFLICT (id) DO NOTHING`);
  svc(`INSERT INTO public.twin_external_refs
         (twin_id, ref_kind, source, source_key, state, proposed_by, confirmed_at, valid_from)
       VALUES ('${DRIVER_TWIN}', 'account', 'aisha_auth', '${DRIVER}', 'confirmed',
               'workflow-timeline-narok-test', now() - interval '1 day', now() - interval '1 day')
       ON CONFLICT DO NOTHING`);
  svc(`UPDATE public.production_workflow_steps s
          SET input_data = coalesce(s.input_data, '{}'::jsonb)
                           || jsonb_build_object('authorized_twin_id', '${DRIVER_TWIN}')
         ${stepsOf(`MUJ-${RUN}`)}`);
  svc(`UPDATE public.production_workflow_steps s SET assigned_role = '${ROLE}' ${stepsOf(`ROLE-${RUN}`)}`);
  svc(`UPDATE public.production_workflow_steps s SET assigned_user_id = '${ASSIGNEE}' ${stepsOf(`PRIRAZ-${RUN}`)}`);

  // Fixtura MUSÍ doložit, že vznikla — prázdný výsledek by jinak vypadal jako vada
  // nároku. Časová osa čte jen story s origin='process'. Počítají se jen NAŠE
  // záznamy (`E-…`): založení běhu vloží do story vlastní úvodní záznam
  // (ensure_production_batch_story), takže běh jich má víc než jeden.
  const entries = svc(`SELECT count(*) FROM public.story_entries se
                         JOIN public.partner_stories ps ON ps.id = se.story_id
                        WHERE ps.origin = 'process' AND ps.title LIKE '%-${RUN}%'
                          AND se.content LIKE 'E-%'`);
  if (entries !== String(3 + FRESH_DECOYS)) {
    throw new Error(`fixtura: očekáváno ${3 + FRESH_DECOYS} záznamů procesních story, je jich ${entries}`);
  }
});

afterAll(() => {
  if (!dbAvailable) return;
  svc(`DELETE FROM public.production_batches b USING public.partner_stories ps
        WHERE b.story_id = ps.id AND ps.title LIKE '%-${RUN}%'`);
  svc(`DELETE FROM public.partner_stories WHERE title LIKE '%-${RUN}%'`);
  svc(`DELETE FROM public.production_workflow_templates WHERE name = '${TEMPLATE}'`);
  svc(`DELETE FROM public.twin_external_refs WHERE twin_id = '${DRIVER_TWIN}'`);
  svc(`DELETE FROM public.twin_entities WHERE id = '${DRIVER_TWIN}'`);
  svc(`DELETE FROM public.user_roles WHERE user_id IN ('${ADMIN}','${ROLER}')`);
  svc(`DELETE FROM aisha_auth.users WHERE id IN ('${ADMIN}','${DRIVER}','${ROLER}','${ASSIGNEE}','${STRANGER}')`);
});

/** Běhy TÉHLE fixtury, každý jednou (běh má v naraci víc záznamů). */
const own = (runs: string[]) =>
  [...new Set(runs.filter((r) => r.endsWith(`-${RUN}`) || r.includes(`-${RUN}-`)))].sort();

describe.skipIf(!dbAvailable)("workflow timeline — nárok", () => {
  it("admin vidí i záznamy běhů, které nejsou jeho", () => {
    expect(own(timelineAs(ADMIN)).some((r) => r.startsWith(`CIZI-${RUN}`))).toBe(true);
  });

  it("⭐ řidič (vazba účtu) vidí svůj STARÝ běh, i když čerstvých cizích je víc než limit — a nic cizího", () => {
    expect(own(timelineAs(DRIVER))).toEqual([`MUJ-${RUN}`]);
  });

  it("držitel role vidí běh, jehož krok je přidělený jeho roli — a nic cizího", () => {
    expect(own(timelineAs(ROLER))).toEqual([`ROLE-${RUN}`]);
  });

  it("přiřazený uživatel vidí běh, jehož krok je jeho — a nic cizího", () => {
    expect(own(timelineAs(ASSIGNEE))).toEqual([`PRIRAZ-${RUN}`]);
  });

  it("uživatel bez role, přiřazení i vazby nevidí nic", () => {
    expect(own(timelineAs(STRANGER))).toEqual([]);
  });
});
