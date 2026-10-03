/**
 * Otevření JEDNOHO kroku (`get_workflow_step_detail`) — kdo na co dosáhne.
 *
 * Zadání majitele (2026-08-05): „Chci si jako admin vybrat dodák a vidět ho tak,
 * jak to je v reálu — jaký má stav a čí je. A platí to úplně plošně."
 *
 * Jsou v tom DVĚ pravidla, která jdou proti sobě, a proto se obě musí měřit:
 *
 *   ⭐ DISPEČER DOSÁHNE NA VŠECHNO. Fronta cizí předání ukazovala už dřív, ale
 *      otevřít se nedala — potvrzovací obrazovka čte osobní frontu. Případ 1
 *      drží, že admin cizí krok dostane, a případ 5 že u něj vidí REALITU
 *      (komu patří), ne pohled, který předstírá, že je jeho.
 *
 *   ⛔ ŘIDIČ NEDOSÁHNE NA CIZÍ. Rozsah 'dispatch' předává volající
 *      BEZPODMÍNEČNĚ a povoluje ho predikát; kdyby se ta konjunkce s rolí
 *      ztratila, stala by se z parametru klíč k cizím dodákům. Případ 3 je
 *      přesně ten pád — a je tichý, protože API vrátí 200 a prázdno vypadá
 *      stejně jako „nic tam není".
 *
 * ⚠️ JMÉNO ÚČTU NENÍ SOUČÁST FRONTY. Kolega, který krok vidí přes SDÍLENOU
 *    ROLI, na něj má nárok — ale identita účtu, kterému je přiřazený, je osobní
 *    údaj a dostane ji jen dispečer (případ 5 vs. 6). Label twinu (řidič,
 *    vozidlo) je naopak v konfiguraci fronty odjakživa, takže se nezastírá.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { execFileSync } from "child_process";
import { randomUUID } from "crypto";
import { PG_HOST, PG_PORT, PG_USER, PG_PASSWORD, PG_DATABASE, isPgReachable } from "./test-env-probe";

const dbAvailable = isPgReachable();
const RUN = randomUUID().slice(0, 8);
const TEMPLATE = `Detail kroku ${RUN}`;

const ADMIN = randomUUID();
const DRIVER = randomUUID();
/** Kolega se STEJNOU rolí jako uzel — nárok má, dispečerem není. */
const MATE = randomUUID();
/** Komu je krok B přiřazen jmenovitě (jeho jméno je ten osobní údaj). */
const OWNER = randomUUID();
const DRIVER_TWIN = randomUUID();
const OWNER_NAME = `Vlastnik ${RUN}`;
const SHARED_ROLE = "production_operator";

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

interface Detail {
  step_id: string;
  status: string;
  batch_code: string | null;
  assigned_role: string | null;
  assigned_to: string | null;
  assigned_twin: string | null;
  is_mine: boolean;
}

/** Co dostane TAHLE identita na TENHLE krok. Prázdné pole = nedosáhne. */
function detailAs(uid: string, stepId: string): Detail[] {
  return JSON.parse(
    psql(
      `{"role":"authenticated","sub":"${uid}"}`,
      `SELECT coalesce(json_agg(row_to_json(d)), '[]'::json)
         FROM public.get_workflow_step_detail('${stepId}') d`,
    ),
  ) as Detail[];
}

/** Id lidského milníku běhu, který se založil pod daným titulem story. */
function stepIdOf(title: string): string {
  const id = svc(`SELECT s.id FROM public.production_workflow_steps s
                    JOIN public.production_batches b ON b.id = s.batch_id
                    JOIN public.partner_stories ps ON ps.id = b.story_id
                   WHERE ps.title = '${title}' LIMIT 1`);
  if (!id) throw new Error(`fixtura: pro '${title}' nevznikl žádný krok`);
  return id;
}

let STEP_DRIVER = "";
let STEP_ROLE = "";

beforeAll(() => {
  if (!dbAvailable) return;

  svc(`INSERT INTO public.production_workflow_templates (name, workflow_steps, is_active)
       SELECT '${TEMPLATE}',
              '[{"step_code":"predej","step_name":"Predani","step_order":1}]'::jsonb, true
       WHERE NOT EXISTS (SELECT 1 FROM public.production_workflow_templates WHERE name = '${TEMPLATE}')`);

  svc(`INSERT INTO aisha_auth.users (id, email) VALUES
         ('${ADMIN}','detail-admin-${RUN}@test.local'),
         ('${DRIVER}','detail-driver-${RUN}@test.local'),
         ('${MATE}','detail-mate-${RUN}@test.local'),
         ('${OWNER}','detail-owner-${RUN}@test.local')
       ON CONFLICT (id) DO NOTHING`);
  svc(`INSERT INTO public.user_roles (user_id, role) VALUES
         ('${ADMIN}', 'admin'),
         ('${MATE}', '${SHARED_ROLE}'),
         ('${OWNER}', '${SHARED_ROLE}')
       ON CONFLICT DO NOTHING`);
  // Jméno účtu je to, co se v případech 5/6 buď vydá, nebo nevydá.
  // ⚠️ UPDATE, ne INSERT: profil zakládá TRIGGER nad `aisha_auth.users`, takže
  // v tuhle chvíli už řádek existuje — s prázdným `display_name`. Vlastní INSERT
  // s `ON CONFLICT DO NOTHING` proto tiše neudělal nic a test měřil NULL proti
  // NULL, tedy nic. Fixtura se musí trefit do tvaru, který platforma vyrábí sama.
  svc(`UPDATE public.profiles SET display_name = '${OWNER_NAME}' WHERE user_id = '${OWNER}'`);
  const named = svc(`SELECT count(*) FROM public.profiles
                      WHERE user_id = '${OWNER}' AND display_name = '${OWNER_NAME}'`);
  if (named !== "1") throw new Error(`fixtura: jméno účtu se nenastavilo (${named})`);

  // ── Běh A: řidičův, vázaný přes POTVRZENOU vazbu účtu na twin ──────────────
  // Uzel ZÁMĚRNĚ bez role: predikát vyhodnocuje roli PŘED vazbou, takže s rolí
  // by na krok dosáhl každý její držitel a případ 3 by neměřil nic.
  svc(`SELECT public.ensure_workflow_run_for_subject(
         '${TEMPLATE}', 'detail-${RUN}-driver', 'RIDIC-${RUN}', current_date, '{}'::jsonb)`);
  svc(`INSERT INTO public.twin_entities (id, entity_type, label)
       VALUES ('${DRIVER_TWIN}', 'driver', 'Ridic ${RUN}')
       ON CONFLICT (id) DO NOTHING`);
  // `proposed_by` je NOT NULL a check `twin_external_refs_confirmed_has_at`
  // vyžaduje u stavu 'confirmed' i čas ratifikace — obojí je pravidlo, ne
  // formalita, a bez nich vazba mlčky nevznikne.
  // ⛔ source = 'aisha_auth': vazba účtu má JEDINÝ zdroj (CHECK twin_external_refs_account_source, 2026-09-10) — dřív tu byl náhradní slug a CHECK ho odmítl.
  svc(`INSERT INTO public.twin_external_refs
         (twin_id, ref_kind, source, source_key, state, proposed_by, confirmed_at, valid_from)
       VALUES ('${DRIVER_TWIN}', 'account', 'aisha_auth', '${DRIVER}', 'confirmed',
               'workflow-step-detail-test', now() - interval '1 day', now() - interval '1 day')
       ON CONFLICT DO NOTHING`);
  STEP_DRIVER = stepIdOf(`RIDIC-${RUN}`);
  svc(`UPDATE public.production_workflow_steps
          SET input_data = coalesce(input_data, '{}'::jsonb)
                           || jsonb_build_object('authorized_twin_id', '${DRIVER_TWIN}')
        WHERE id = '${STEP_DRIVER}'`);

  // ── Běh B: přiřazený jmenovitě OWNERovi a zároveň sdílené roli ─────────────
  svc(`SELECT public.ensure_workflow_run_for_subject(
         '${TEMPLATE}', 'detail-${RUN}-role', 'ROLE-${RUN}', current_date, '{}'::jsonb)`);
  STEP_ROLE = stepIdOf(`ROLE-${RUN}`);
  svc(`UPDATE public.production_workflow_steps
          SET assigned_user_id = '${OWNER}', assigned_role = '${SHARED_ROLE}'
        WHERE id = '${STEP_ROLE}'`);

  // Fixtura musí doložit, že vznikla: prázdný výsledek by jinak vypadal jako
  // vada nároku, i kdyby se jen nebylo na co dívat.
  const ok = svc(`SELECT count(*) FROM public.production_workflow_steps
                   WHERE id IN ('${STEP_DRIVER}','${STEP_ROLE}')
                     AND (input_data->>'authorized_twin_id' = '${DRIVER_TWIN}'
                          OR assigned_user_id = '${OWNER}')`);
  if (ok !== "2") throw new Error(`fixtura: očekávány 2 připravené kroky, je jich ${ok}`);
});

afterAll(() => {
  if (!dbAvailable) return;
  svc(`DELETE FROM public.production_batches b
        USING public.partner_stories ps
        WHERE b.story_id = ps.id AND ps.title LIKE '%-${RUN}%'`);
  svc(`DELETE FROM public.partner_stories WHERE title LIKE '%-${RUN}%'`);
  svc(`DELETE FROM public.production_workflow_templates WHERE name = '${TEMPLATE}'`);
  svc(`DELETE FROM public.twin_external_refs WHERE twin_id = '${DRIVER_TWIN}'`);
  svc(`DELETE FROM public.twin_entities WHERE id = '${DRIVER_TWIN}'`);
  svc(`DELETE FROM public.profiles WHERE user_id = '${OWNER}'`);
  svc(`DELETE FROM public.user_roles WHERE user_id IN ('${ADMIN}','${DRIVER}','${MATE}','${OWNER}')`);
  svc(`DELETE FROM aisha_auth.users WHERE id IN ('${ADMIN}','${DRIVER}','${MATE}','${OWNER}')`);
});

describe.skipIf(!dbAvailable)("detail kroku — kdo na co dosáhne", () => {
  it("⭐ admin otevře CIZÍ krok a dostane ho celý", () => {
    const rows = detailAs(ADMIN, STEP_DRIVER);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.step_id).toBe(STEP_DRIVER);
  });

  it("⭐ a vidí REALITU: že to není jeho a komu to patří", () => {
    const [row] = detailAs(ADMIN, STEP_DRIVER);
    // `is_mine=false` je to, co obrazovka překládá na „potvrzujete za někoho
    // jiného". Kdyby bylo true, dispečer by netušil, že jedná cizím jménem.
    expect(row!.is_mine).toBe(false);
    expect(row!.assigned_twin).toBe(`Ridic ${RUN}`);
  });

  it("řidič otevře SVŮJ krok a je označen jako jeho", () => {
    const rows = detailAs(DRIVER, STEP_DRIVER);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.is_mine).toBe(true);
  });

  it("⛔ řidič na CIZÍ krok nedosáhne (prázdno, ne chyba)", () => {
    expect(detailAs(DRIVER, STEP_ROLE)).toEqual([]);
  });

  it("neexistující krok vrací TOTÉŽ prázdno jako krok bez nároku", () => {
    // Rozlišit ty dva případy by z funkce udělalo orákulum na existenci cizích
    // běhů — kdo zkouší id, dozvěděl by se, která existují.
    expect(detailAs(DRIVER, randomUUID())).toEqual([]);
  });

  it("kolega se stejnou rolí krok VIDÍ (nárok přes roli platí dál)", () => {
    const rows = detailAs(MATE, STEP_ROLE);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.assigned_role).toBe(SHARED_ROLE);
  });

  it("⚠️ ale jméno účtu, kterému je krok přiřazen, kolega NEDOSTANE", () => {
    // Past, na kterou tenhle případ vznikl: „vidím ten krok" se zdálo být dobré
    // kritérium pro vydání jména — jenže viditelnost přes SDÍLENOU ROLI má celá
    // směna, takže by jméno kolegy dostal každý její člen. Nárok na krok a nárok
    // na identitu účtu jsou dvě různé otázky.
    expect(detailAs(MATE, STEP_ROLE)[0]!.assigned_to).toBeNull();
  });

  it("dispečer jméno dostane — a člověk o sobě taky", () => {
    expect(detailAs(ADMIN, STEP_ROLE)[0]!.assigned_to).toBe(OWNER_NAME);
    expect(detailAs(OWNER, STEP_ROLE)[0]!.assigned_to).toBe(OWNER_NAME);
  });
});
