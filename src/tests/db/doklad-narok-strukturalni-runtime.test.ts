/**
 * NÁROK NA DOKLAD: „tenhle doklad vezu já."
 *
 * ⛔ NAMĚŘENO 2026-09-01: řetěz oprávnění k dokladu končil naprázdno. Řidič svůj
 * KROK vidí (`workflow_step_visible_to` přes `authorized_twin_id` + POTVRZENOU
 * vazbu účtu), ale DOKLAD, ze kterého ten krok vznikl, ne — jediný nárok člena
 * byl tier × citlivost, tedy „jak vysoko jsem", ne „je to moje zásilka".
 * Materiál a množství jsou přitom na dokladu (`line_items`), takže je řidič
 * neviděl a povrch pro něj neměl co ukázat.
 *
 * ⭐ CO SE MĚŘÍ: že přidaný člen politiky změnil PRÁVĚ JEDNU třídu identity.
 * Admin vidí totéž co dřív, řidič BEZ běhu nevidí nic, a řidič S během vidí
 * právě svůj doklad — ne cizí. Kdyby se pohnula kterákoli jiná třída, je to
 * rozšíření nároku, ne oprava.
 *
 * ⛔ POZOR NA VÝKON: nový člen je MNOŽINOVÝ (`doc_slug IN (…)`), ne per-row
 * funkce. Per-row predikát nad tímhle registrem stál 41 252 ms a byl DoS pákou
 * (viz hlavička `li_source_registry_read`); tenhle se vyhodnotí jednou za dotaz
 * a jde přes KROKY, kterých je řádově méně než dokladů.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { execFileSync } from "child_process";
import { randomUUID } from "crypto";
import { PG_HOST, PG_PORT, PG_USER, PG_PASSWORD, PG_DATABASE, isPgReachable } from "./test-env-probe";

const dbAvailable = isPgReachable();
const RUN = randomUUID().slice(0, 8);
const TEMPLATE = `Nárok na doklad ${RUN}`;

const ADMIN = randomUUID();
const RIDIC = randomUUID();
const CIZI = randomUUID();
const RIDIC_TWIN = randomUUID();

const SLUG_MUJ = `doc-${RUN}-muj`;
const SLUG_CIZI = `doc-${RUN}-cizi`;
const SHA_MUJ = `sha-${RUN}-muj`;
const SHA_CIZI = `sha-${RUN}-cizi`;

/**
 * `role` = DB role, pod kterou dotaz běží. Připojení je superuser, který RLS
 * OBCHÁZÍ; čtení tabulky pod politikou musí jít přes `SET ROLE authenticated`.
 * Výstup toho SET se tlumí spolu s nastavením claims, aby nešuměl do výsledku.
 */
function psql(claims: string, sql: string, role?: string): string {
  const nastavRoli = role ? `SET ROLE ${role};\n` : "";
  return execFileSync(
    "psql",
    ["-h", PG_HOST, "-p", PG_PORT, "-U", PG_USER, "-d", PG_DATABASE, "-v", "ON_ERROR_STOP=1", "-tA"],
    {
      input: `\\o /dev/null\nSET request.jwt.claims = '${claims}';\n${nastavRoli}\\o\n${sql};`,
      encoding: "utf-8",
      env: { ...process.env, PGPASSWORD: PG_PASSWORD },
    },
  ).trim();
}
const svc = (sql: string) => psql('{"role":"service_role"}', sql);
/** Kolik z NAŠICH dvou dokladů daná identita vidí. Ne „kolik řádků má registr" —
 *  to by měřilo cizí data a odpověď by kolísala s korpusem. */
// ⛔ ČTE SE TABULKA PŘÍMO, NE RPC — a psql se připojuje jako superuser, který RLS
//    OBCHÁZÍ. Bez `SET ROLE authenticated` politika vůbec neběží a každá identita
//    „vidí" oba doklady: test pak měří superusera, ne nárok. Sourozenci
//    (timing-tower, step-detail) to nepotřebují, protože volají RPC, které si
//    `auth.uid()` ověřují samy. Naměřeno 2026-09-10 při prvním spuštění testu.
const vidi = (uid: string) =>
  psql(`{"sub":"${uid}","role":"authenticated"}`,
       `SELECT coalesce(string_agg(doc_slug, ',' ORDER BY doc_slug), '')
          FROM public.li_source_registry
         WHERE doc_slug IN ('${SLUG_MUJ}', '${SLUG_CIZI}')`,
       "authenticated");

beforeAll(() => {
  if (!dbAvailable) return;

  // ⛔ `ON CONFLICT (name)` tu NELZE: `name` šablony NENÍ v modelu unikátní (žádný index,
  //    seed ho jako klíč nepoužívá) a Postgres takový cíl konfliktu odmítne. Dům používá
  //    `WHERE NOT EXISTS` (dispatcher-all-assignees, entity-reference-resolve).
  svc(`INSERT INTO public.production_workflow_templates (name, workflow_steps, is_active)
       SELECT '${TEMPLATE}',
               '[{"step_code":"predani","step_name":"Predani","step_order":1}]'::jsonb, true
       WHERE NOT EXISTS (SELECT 1 FROM public.production_workflow_templates WHERE name = '${TEMPLATE}')`);

  // Dva doklady v evidenci: jeden řidičův, jeden cizí. Obojí PROMOVANÉ, aby
  // rozdíl nedělala promotion brána, ale právě strukturální nárok.
  for (const [slug, sha] of [[SLUG_MUJ, SHA_MUJ], [SLUG_CIZI, SHA_CIZI]]) {
    svc(`INSERT INTO public.li_source_registry (doc_slug, source_sha256, doc_type, fields)
         VALUES ('${slug}', '${sha}', 'delivery_note', '{}'::jsonb)
         ON CONFLICT (source_sha256) DO NOTHING`); // jediný unikát registru je source_sha256; doc_slug unikátní NENÍ
  }

  // Řidič: twin + POTVRZENÁ vazba účtu (bez ní predikát neuzná nic — a přesně
  // tady dnes celý řetěz končil, protože takových vazeb je v produkci nula).
  // ⛔ Účty MUSÍ existovat dřív než role a vazba: `user_roles.user_id` má FK na
  //    `aisha_auth.users`. Test to nikdy nezakládal — a nikdy neběžel. Vzor: timing-tower.
  svc(`INSERT INTO aisha_auth.users (id, email) VALUES
         ('${ADMIN}','doklad-admin-${RUN}@test.local'),
         ('${RIDIC}','doklad-ridic-${RUN}@test.local')
       ON CONFLICT (id) DO NOTHING`);
  svc(`INSERT INTO public.twin_entities (id, entity_type, label)
       VALUES ('${RIDIC_TWIN}', 'driver', 'Ridic ${RUN}') ON CONFLICT (id) DO NOTHING`);
  // ⛔ source = 'aisha_auth': vazba účtu má JEDINÝ zdroj (CHECK twin_external_refs_account_source, 2026-09-10) — dřív tu byl náhradní slug a CHECK ho odmítl.
  svc(`INSERT INTO public.twin_external_refs
         (twin_id, ref_kind, source, source_key, state, proposed_by, confirmed_at, valid_from)
       VALUES ('${RIDIC_TWIN}', 'account', 'aisha_auth', '${RIDIC}', 'confirmed',
               'narok-dokladu-test', now() - interval '1 day', now() - interval '1 day')
       ON CONFLICT DO NOTHING`);

  // Běh nad ŘIDIČOVÝM dokladem; uzel bez role, aby nárok stál výhradně na vazbě.
  svc(`SELECT public.ensure_workflow_run_for_subject(
         '${TEMPLATE}', 'narok-${RUN}', 'DL-${RUN}', current_date,
         jsonb_build_object('doc_slug', '${SLUG_MUJ}'))`);
  svc(`UPDATE public.production_workflow_steps s
          SET input_data = coalesce(s.input_data, '{}'::jsonb)
                           || jsonb_build_object('authorized_twin_id', '${RIDIC_TWIN}')
         FROM public.production_batches b
        WHERE b.id = s.batch_id AND b.batch_code = 'narok-${RUN}'`);

  svc(`INSERT INTO public.user_roles (user_id, role) VALUES ('${ADMIN}', 'admin')
       ON CONFLICT DO NOTHING`);

  // Fixtura musí doložit, že vznikla: prázdno by jinak vypadalo jako splněný nárok.
  const kroku = svc(`SELECT count(*) FROM public.production_workflow_steps s
                       JOIN public.production_batches b ON b.id = s.batch_id
                      WHERE b.batch_code = 'narok-${RUN}'
                        AND s.input_data->>'doc_slug' = '${SLUG_MUJ}'`);
  if (kroku === "0") throw new Error("fixtura: krok s doc_slug nevznikl — test by měřil prázdno");
});

afterAll(() => {
  if (!dbAvailable) return;
  svc(`DELETE FROM public.li_source_registry WHERE doc_slug IN ('${SLUG_MUJ}','${SLUG_CIZI}')`);
  svc(`DELETE FROM public.twin_external_refs WHERE twin_id = '${RIDIC_TWIN}'`);
  svc(`DELETE FROM public.user_roles WHERE user_id = '${ADMIN}'`);
  svc(`DELETE FROM aisha_auth.users WHERE id IN ('${ADMIN}','${RIDIC}')`);
});

describe.skipIf(!dbAvailable)("nárok na doklad — mění se PRÁVĚ JEDNA třída identity", () => {
  it("admin vidí oba doklady (jeho nárok se nezměnil)", () => {
    expect(vidi(ADMIN)).toBe(`${SLUG_CIZI},${SLUG_MUJ}`);
  });

  it("⭐ řidič S BĚHEM vidí právě SVŮJ doklad", () => {
    expect(vidi(RIDIC)).toBe(SLUG_MUJ);
  });

  it("⛔ řidič s během NEVIDÍ cizí doklad (nárok je strukturální, ne plošný)", () => {
    expect(vidi(RIDIC)).not.toContain(SLUG_CIZI);
  });

  it("⛔ účet BEZ běhu nevidí nic (jeho nárok se nezměnil)", () => {
    expect(vidi(CIZI)).toBe("");
  });

  it("⛔ vazba účtu je PODMÍNKA, ne formalita — bez potvrzení nárok mizí", () => {
    svc(`UPDATE public.twin_external_refs SET state = 'proposed', confirmed_at = NULL
          WHERE twin_id = '${RIDIC_TWIN}' AND ref_kind = 'account'`);
    try {
      expect(vidi(RIDIC)).toBe("");
    } finally {
      svc(`UPDATE public.twin_external_refs
              SET state = 'confirmed', confirmed_at = now() - interval '1 day'
            WHERE twin_id = '${RIDIC_TWIN}' AND ref_kind = 'account'`);
    }
  });
});
