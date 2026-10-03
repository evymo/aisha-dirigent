/**
 * Přesný klíč → entita (`resolve_entity_reference`) + kanál `target` v odpovědi.
 *
 * Zadání majitele (2026-08-05): „Dohledat to přes dotaz AIŠE, která by nás na
 * ten list měla nasměrovat… a dodáky jí samozřejmě chceme dát taky, vše."
 * + „multi twinverse".
 *
 * Odpovídač si dodnes rozřazuje otázku REGEXEM a dodák mezi jeho záměry NENÍ.
 * Tohle proto klasifikaci NEROZŠIŘUJE — hledá SHODU. Číslo dokladu není úloha
 * pro model, je to klíč. Měří se čtyři vlastnosti, na kterých to stojí:
 *
 *   ⭐ KLÍČE JSOU DATA. Které pole je identita, se čte z katalogu parametrů
 *      (`twin_parameter_definitions.metadata->>'identity'`). Případ „bez
 *      deklarace se nenajde nic" je důkaz, že platforma opravdu nezná jméno
 *      pole — jinak by fungovala i bez katalogu a bylo by to natvrdo v kódu.
 *
 *   ⛔ NEJEDNOZNAČNOST = ŽÁDNÝ VÝSLEDEK. Čísla dokladů se přes vystavující
 *      firmy opakují. „Ten první" by poslal člověka na cizí doklad a on by to
 *      nepoznal, protože by dostal platně vypadající obrazovku.
 *
 *   ⛔ NÁROK SE NEOBCHÁZÍ. Bez toho je resolver orákulum: „existuje dodák
 *      12345?" by šlo zjistit i bez práva ho vidět.
 *
 *   ⚠️ `target` JEN NA VYŽÁDÁNÍ. Ajv je all-or-nothing a povrchy se nasazují
 *      jinou kadencí než jádro, takže klient, který o pole nepožádá, musí
 *      dostat bajtově tutéž obálku jako dosud.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { execFileSync } from "child_process";
import { randomUUID } from "crypto";
import { PG_HOST, PG_PORT, PG_USER, PG_PASSWORD, PG_DATABASE, isPgReachable } from "./test-env-probe";

const dbAvailable = isPgReachable();
const RUN = randomUUID().slice(0, 8);
const TEMPLATE = `Klic ${RUN}`;
const ADMIN = randomUUID();
const OUTSIDER = randomUUID();

/** Parametr, který se v katalogu OZNAČÍ jako identita. */
const KEY_CODE = `test_doc_no_${RUN}`;
/** Parametr se stejným tvarem, který označený NENÍ — kontrolní skupina. */
const PLAIN_CODE = `test_plain_${RUN}`;

const UNIQUE_KEY = `DL-${RUN}-UNIKAT`;
const DUPLICATE_KEY = `DL-${RUN}-DVAKRAT`;
const PLAIN_KEY = `DL-${RUN}-NEOZNACENO`;

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

interface Hit { entity_kind: string; entity_id: string; label: string; matched_by: string }

function resolveAs(uid: string, key: string): Hit[] {
  return JSON.parse(
    psql(
      `{"role":"authenticated","sub":"${uid}"}`,
      `SELECT coalesce(json_agg(row_to_json(r)), '[]'::json)
         FROM public.resolve_entity_reference('${key}') r`,
    ),
  ) as Hit[];
}

/** Krok běhu, jehož konfigurace nese daný klíč. */
function stepWith(code: string, key: string): string {
  return svc(`SELECT s.id FROM public.production_workflow_steps s
               WHERE s.input_data->>'${code}' = '${key}' LIMIT 1`);
}

beforeAll(() => {
  if (!dbAvailable) return;

  svc(`INSERT INTO aisha_auth.users (id, email) VALUES
         ('${ADMIN}','klic-admin-${RUN}@test.local'),
         ('${OUTSIDER}','klic-cizi-${RUN}@test.local')
       ON CONFLICT (id) DO NOTHING`);
  svc(`INSERT INTO public.user_roles (user_id, role) VALUES ('${ADMIN}','admin')
       ON CONFLICT DO NOTHING`);

  // Katalog: JEDEN parametr označený jako identita, druhý ZÁMĚRNĚ ne.
  svc(`INSERT INTO public.twin_parameter_definitions
         (code, name, entity_type, data_type, source, aggregation, metadata)
       VALUES
         ('${KEY_CODE}',  'Klic',  'test_doc', 'text', 'test', 'last', '{"identity": true}'::jsonb),
         ('${PLAIN_CODE}','Jiny',  'test_doc', 'text', 'test', 'last', '{}'::jsonb)
       ON CONFLICT (code) DO UPDATE SET metadata = excluded.metadata`);

  svc(`INSERT INTO public.production_workflow_templates (name, workflow_steps, is_active)
       SELECT '${TEMPLATE}',
              '[{"step_code":"predani","step_name":"Predani","step_order":1}]'::jsonb, true
       WHERE NOT EXISTS (SELECT 1 FROM public.production_workflow_templates WHERE name = '${TEMPLATE}')`);

  // Čtyři běhy: unikát · dvojice se STEJNÝM klíčem · neoznačený parametr.
  for (const code of ["unikat", "dupl-a", "dupl-b", "plain"]) {
    svc(`SELECT public.ensure_workflow_run_for_subject(
           '${TEMPLATE}', 'klic-${RUN}-${code}', '${code.toUpperCase()}-${RUN}',
           current_date, '{}'::jsonb)`);
  }
  const put = (title: string, code: string, key: string) =>
    svc(`UPDATE public.production_workflow_steps s
            SET input_data = coalesce(s.input_data,'{}'::jsonb)
                             || jsonb_build_object('${code}', '${key}')
           FROM public.production_batches b
           JOIN public.partner_stories ps ON ps.id = b.story_id
          WHERE s.batch_id = b.id AND ps.title = '${title}-${RUN}'`);
  put("UNIKAT", KEY_CODE, UNIQUE_KEY);
  put("DUPL-A", KEY_CODE, DUPLICATE_KEY);
  put("DUPL-B", KEY_CODE, DUPLICATE_KEY);
  put("PLAIN", PLAIN_CODE, PLAIN_KEY);

  const ready = svc(`SELECT count(*) FROM public.production_workflow_steps
                      WHERE input_data->>'${KEY_CODE}' IS NOT NULL
                         OR input_data->>'${PLAIN_CODE}' IS NOT NULL`);
  if (ready !== "4") throw new Error(`fixtura: očekávány 4 kroky s klíčem, je jich ${ready}`);
});

afterAll(() => {
  if (!dbAvailable) return;
  svc(`DELETE FROM public.production_batches b
        USING public.partner_stories ps
        WHERE b.story_id = ps.id AND ps.title LIKE '%-${RUN}'`);
  svc(`DELETE FROM public.partner_stories WHERE title LIKE '%-${RUN}'`);
  svc(`DELETE FROM public.production_workflow_templates WHERE name = '${TEMPLATE}'`);
  svc(`DELETE FROM public.twin_parameter_definitions WHERE code IN ('${KEY_CODE}','${PLAIN_CODE}')`);
  svc(`DELETE FROM public.user_roles WHERE user_id = '${ADMIN}'`);
  svc(`DELETE FROM aisha_auth.users WHERE id IN ('${ADMIN}','${OUTSIDER}')`);
});

describe.skipIf(!dbAvailable)("přesný klíč → entita", () => {
  it("⭐ jednoznačný klíč najde právě ten záznam", () => {
    const hits = resolveAs(ADMIN, UNIQUE_KEY);
    expect(hits).toHaveLength(1);
    expect(hits[0]!.entity_kind).toBe("workflow_step");
    expect(hits[0]!.entity_id).toBe(stepWith(KEY_CODE, UNIQUE_KEY));
    // Čím se trefil — aby bylo z odpovědi poznat, které pole rozhodlo.
    expect(hits[0]!.matched_by).toBe(KEY_CODE);
  });

  it("⛔ DVA záznamy se stejným klíčem = ŽÁDNÝ výsledek, ne ten první", () => {
    expect(resolveAs(ADMIN, DUPLICATE_KEY)).toEqual([]);
  });

  it("⭐ pole NEOZNAČENÉ v katalogu se nehledá — klíče jsou DATA, ne kód", () => {
    // Kdyby platforma znala jméno pole natvrdo, tenhle případ by našel záznam.
    expect(resolveAs(ADMIN, PLAIN_KEY)).toEqual([]);
  });

  it("⛔ kdo na krok nedosáhne, nedostane ani odpověď, že existuje", () => {
    expect(resolveAs(OUTSIDER, UNIQUE_KEY)).toEqual([]);
  });

  it("prázdný a neexistující klíč vrací prázdno (ne chybu)", () => {
    expect(resolveAs(ADMIN, "   ")).toEqual([]);
    expect(resolveAs(ADMIN, `NIC-${RUN}`)).toEqual([]);
  });
});

describe.skipIf(!dbAvailable)("kanál `target` v odpovědi", () => {
  const ask = (params: Record<string, unknown>) =>
    JSON.parse(
      psql(
        `{"role":"authenticated","sub":"${ADMIN}"}`,
        `SELECT public.get_answer_block('${JSON.stringify(params)}'::jsonb)`,
      ),
    ) as { target?: { entity_kind: string; entity_id: string; label?: string } };

  it("⭐ na vyžádání nese odpověď CÍL, který se dá otevřít", () => {
    const out = ask({ question: `kde je ${UNIQUE_KEY}`, want_target: true });
    expect(out.target?.entity_kind).toBe("workflow_step");
    expect(out.target?.entity_id).toBe(stepWith(KEY_CODE, UNIQUE_KEY));
  });

  it("⚠️ BEZ vyžádání se pole neposílá — starý klient dostane tutéž obálku", () => {
    // Ajv je all-or-nothing: jedno neznámé pole = „data se nepodařilo načíst".
    const out = ask({ question: `kde je ${UNIQUE_KEY}` });
    expect(out.target).toBeUndefined();
  });

  it("otázka bez klíče cíl nemá — nasměrování se NEVYMÝŠLÍ", () => {
    const out = ask({ question: "kolik je hodin", want_target: true });
    expect(out.target).toBeUndefined();
  });
});
