/**
 * Klíče protistrany pod RLS jdou přes INDEX — generované sloupce registru (RUNTIME).
 *
 * ⛔ NAMĚŘENO 2026-09-29 na riq (jen čtení, `authenticated` + claims správce): karta
 * protistrany — `counterparty_resolve` 2 706 ms, tentýž dotaz jako service_role 23 ms.
 * Pod RLS smí planner pustit podmínku před politiku (a tedy do Index Cond) jen když je
 * leakproof; `fields->'counterparty_id'->>'value'` (jsonb_object_field_text) ani
 * `fields @> …` leakproof nejsou → seq scan celé evidence s rozbalováním JSON, i když
 * expresní index (idx_li_source_registry_counterparty_id, 2026-09-23) existoval.
 * Oprava: klíče jako GENEROVANÉ sloupce + btree; `texteq` nad prostým sloupcem leakproof je.
 *
 * Měří se:
 *   - sloupec = výraz nad `fields` pro každý tvar (objekt, starší skalár, chybí) i po UPDATE;
 *   - pod RLS (správce i člen bez nároku) jde filtr přes sloupec do indexu;
 *   - KONTROLNÍ VZOREK: tentýž filtr výrazem nad `fields` index nedostane ani se
 *     zakázaným seq scanem — jinak by test neuměl rozlišit opravu od náhody plánu;
 *   - staré expresní indexy nezůstaly (planner je pod RLS nepoužil, jen se udržovaly).
 *
 * Spouští se přes: node scripts/db/with-throwaway-db.mjs -- npx vitest run <tento soubor>
 */
import { randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { describe, expect, it } from "vitest";
import { PG_HOST, PG_PORT, PG_USER, PG_PASSWORD, PG_DATABASE, isPgReachable } from "./test-env-probe";

const DB_SLIBENA = Boolean(process.env.AISHA_DB_URL);
const RUN = randomUUID().slice(0, 8);
const ICO = `9${RUN.replace(/[^0-9]/g, "").padEnd(7, "7").slice(0, 7)}`;
const SPRAVCE = randomUUID();
const CLEN = randomUUID();

function psql(sql: string, claims?: string, role?: string): string {
  const pre = ["\\o /dev/null", claims ? `SET request.jwt.claims = '${claims}';` : "", role ? `SET ROLE ${role};` : "", "SET enable_seqscan = off;", "\\o"].join("\n");
  return execFileSync(
    "psql",
    ["-h", PG_HOST, "-p", PG_PORT, "-U", PG_USER, "-d", PG_DATABASE, "-v", "ON_ERROR_STOP=1", "-tA"],
    { input: `${pre}\n${sql};`, encoding: "utf-8", env: { ...process.env, PGPASSWORD: PG_PASSWORD }, stdio: ["pipe", "pipe", "pipe"] },
  ).trim();
}
const plan = (where: string, kdo: string) =>
  psql(`EXPLAIN (COSTS OFF) SELECT r.doc_slug FROM public.li_source_registry r
         WHERE r.superseded_by IS NULL AND ${where}`, `{"sub":"${kdo}","role":"authenticated"}`, "authenticated");

describe.skipIf(!isPgReachable() && !DB_SLIBENA)("karta protistrany: klíče pod RLS přes index", () => {
  it("příprava: správce, doklady ve všech tvarech pole", () => {
    psql(`INSERT INTO auth.users (id, email) VALUES ('${SPRAVCE}', 'spravce-${RUN}@test.local')`);
    psql(`INSERT INTO public.user_roles (user_id, role) VALUES ('${SPRAVCE}', 'admin')`);
    psql(`INSERT INTO public.li_source_registry (source_sha256, doc_slug, doc_type, fields) VALUES
          ('kr-obj-${RUN}',   'kr-obj-${RUN}',   'invoice', jsonb_build_object(
             'counterparty_id', jsonb_build_object('value', '${ICO}', 'raw', 'IČ ${ICO}'),
             'counterparty',    jsonb_build_object('value', 'Karta RLS ${RUN} s.r.o.'),
             'owner_company',   jsonb_build_object('value', 'Naše firma ${RUN}'))),
          ('kr-skalar-${RUN}', 'kr-skalar-${RUN}', 'invoice', jsonb_build_object('counterparty_id', '${ICO}', 'counterparty', 'skalár')),
          ('kr-bez-${RUN}',    'kr-bez-${RUN}',    'invoice', '{}'::jsonb),
          ('kr-ocnull-${RUN}', 'kr-ocnull-${RUN}', 'invoice', '{"owner_company":{"value":null}}'::jsonb),
          ('kr-ocskal-${RUN}', 'kr-ocskal-${RUN}', 'invoice', '{"owner_company":"Skalár firma"}'::jsonb)`);
    // Výplň + statistiky: nad hrstkou řádků bez ANALYZE volí planner podle ceny
    // i celý jiný index s filtrem (naměřeno) — měří se schopnost, ne náhoda ceny.
    // Typ `kr-vypln` žádná čtečka nečte; úklid na konci.
    psql(`INSERT INTO public.li_source_registry (source_sha256, doc_slug, doc_type, fields)
          SELECT 'kr-v-${RUN}-' || g, 'kr-v-${RUN}-' || g, 'kr-vypln', jsonb_build_object(
                   'counterparty_id', jsonb_build_object('value', 'V${RUN}-' || g),
                   'counterparty',    jsonb_build_object('value', 'Výplň ${RUN} ' || g))
            FROM generate_series(1, 2000) g`);
    psql(`ANALYZE public.li_source_registry`);
  });

  it("sloupec = výraz nad fields pro každý tvar i po změně fields", () => {
    const rozdil = () => psql(`SELECT count(*) FROM public.li_source_registry
       WHERE doc_slug LIKE 'kr-%-${RUN}'
         AND (counterparty_id_value IS DISTINCT FROM fields->'counterparty_id'->>'value'
           OR counterparty_value    IS DISTINCT FROM fields->'counterparty'->>'value'
           OR owner_company_value   IS DISTINCT FROM fields->'owner_company'->>'value')`);
    expect(rozdil()).toBe("0");
    expect(psql(`SELECT coalesce(counterparty_id_value, '∅') FROM public.li_source_registry WHERE doc_slug = 'kr-skalar-${RUN}'`),
      "starší skalár: výraz ->>'value' dává NULL, sloupec totéž").toBe("∅");
    psql(`UPDATE public.li_source_registry
             SET fields = jsonb_set(fields, '{counterparty_id}', '{"value":"80000001"}')
           WHERE doc_slug = 'kr-bez-${RUN}'`);
    expect(psql(`SELECT counterparty_id_value FROM public.li_source_registry WHERE doc_slug = 'kr-bez-${RUN}'`)).toBe("80000001");
    expect(rozdil()).toBe("0");
  });

  it("pod RLS jde filtr přes sloupec do indexu — správce i člen bez nároku", () => {
    for (const [kdo, jmeno] of [[SPRAVCE, "správce"], [CLEN, "člen"]]) {
      const ico = plan(`r.counterparty_id_value = ANY (ARRAY['${ICO}'])`, kdo);
      expect(ico, `${jmeno}:\n${ico}`).toMatch(/Index Cond: \(counterparty_id_value = /);
      const jm = plan(`r.counterparty_value = 'Karta RLS ${RUN} s.r.o.'`, kdo);
      expect(jm, `${jmeno}:\n${jm}`).toMatch(/Index Cond: \(counterparty_value = /);
    }
  });

  it("kontrolní vzorek: výraz nad fields index pod RLS nedostane ani bez seq scanu", () => {
    // Pod service_role (bez RLS) by index dostal — rozdíl dělá leakproof, ne plán.
    // Se zakázaným seq scanem smí planner vzít celý částečný index (predikát
    // superseded_by IS NULL) — výraz ale zůstane ve Filter, nikdy v Index Cond.
    const vyraz = plan(`(r.fields->'counterparty_id'->>'value') = ANY (ARRAY['${ICO}'])`, SPRAVCE);
    expect(vyraz, vyraz).toMatch(/Filter: .*'counterparty_id'::text\) ->> 'value'::text\) = ANY/);
    expect(vyraz, vyraz).not.toMatch(/Index Cond: .*counterparty/);
  });

  it("výsledek pod RLS: správce doklad najde přes sloupec, člen bez nároku ne", () => {
    const pocet = (kdo: string) => psql(`SELECT count(*) FROM public.li_source_registry r
       WHERE r.superseded_by IS NULL AND r.counterparty_id_value = '${ICO}'`, `{"sub":"${kdo}","role":"authenticated"}`, "authenticated");
    expect(pocet(SPRAVCE)).toBe("1");
    expect(pocet(CLEN)).toBe("0");
  });

  it("osa firma (get_scope_options) přes sloupec = dřívější výpočet přes fields — A/B nad týmiž daty", () => {
    // Dřívější z_registru: `fields ? klic` + hodnota `fields->klic->>'value'`; souhrn
    // zahodí prázdné. Klíč bez hodnoty i skalár tedy nepropadnou ani jedním způsobem.
    const stejne = psql(`SELECT (public.get_scope_options('{}'::jsonb)->'data'->'options') = coalesce((
        SELECT jsonb_agg(jsonb_build_object('value', hodnota, 'count', pocet) ORDER BY pocet DESC, hodnota)
          FROM (SELECT hodnota, count(*) AS pocet
                  FROM (SELECT r.fields->'owner_company'->>'value' AS hodnota
                          FROM public.li_source_registry r
                         WHERE r.superseded_by IS NULL AND r.fields ? 'owner_company') v
                 WHERE hodnota IS NOT NULL AND btrim(hodnota) <> ''
                 GROUP BY hodnota ORDER BY count(*) DESC, hodnota LIMIT 50) s), '[]'::jsonb)`,
      `{"sub":"${SPRAVCE}","role":"authenticated"}`, "authenticated");
    expect(stejne).toBe("t");
    const volby = psql(`SELECT public.get_scope_options('{}'::jsonb)->'data'->'options'`,
      `{"sub":"${SPRAVCE}","role":"authenticated"}`, "authenticated");
    expect(volby, "naše firma z dokladu je mezi volbami").toContain(`Naše firma ${RUN}`);
  });

  it("úklid výplně", () => {
    // Výplň kaskádově maže li_doc_scope_keys. Souběžná sada ve sdílené DB, která mění pravidla
    // rozsahu, přestavuje klíče VŠECH dokladů (fn_twin_scope_doc_rules_prestav) — obě transakce
    // zamykají tytéž řádky v opačném pořadí → deadlock (naměřeno 2026-09-30, 12 sad v jedné DB).
    // Postgres zruší jednu oběť; úklid se proto opakuje a výsledek ověří počet níž.
    psql(`DO $$ BEGIN
      FOR i IN 1..5 LOOP
        BEGIN
          DELETE FROM public.li_source_registry WHERE doc_type = 'kr-vypln' AND doc_slug LIKE 'kr-v-${RUN}-%';
          RETURN;
        EXCEPTION WHEN deadlock_detected THEN
          PERFORM pg_sleep(0.2 * i);
        END;
      END LOOP;
      RAISE EXCEPTION 'úklid výplně: deadlock i po 5 pokusech';
    END $$`);
    expect(psql(`SELECT count(*) FROM public.li_source_registry WHERE doc_slug LIKE 'kr-v-${RUN}-%'`)).toBe("0");
  });

  it("staré expresní indexy nezůstaly", () => {
    expect(psql(`SELECT count(*) FROM pg_indexes WHERE schemaname = 'public'
       AND indexname IN ('idx_li_source_registry_counterparty_id', 'idx_li_source_registry_counterparty')`)).toBe("0");
  });
});
