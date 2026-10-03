/**
 * counterparty_resolve čte dvojčata ve SDÍLENÝCH množinách — rozsah uživatele se
 * nepočítá v každé větvi znovu (RUNTIME, throwaway DB).
 *
 * ⛔ NAMĚŘENO 2026-09-30 na riq (člen 7f2a3dd3, jen čtení): každý výskyt twin_entities /
 * twin_external_refs v dotazu nese vlastní výpočet rozsahu v RLS (twin_ids_v_rozsahu,
 * ~120 ms; Postgres ho mezi výskyty nesdílí). Resolve ho počítal 4× (vstup dlužník)
 * a 8× (vstup dvojče), karta člena 37× = 3,4 s z 6,7 s. Po přestavbě 3× a 5×,
 * 6 opakování: −20 % / −31 %; výsledek shodný (A/B 180 vstupů služba + 80 člen).
 *
 * Měří se POČET volání twin_ids_v_rozsahu v jedné transakci (pg_stat_xact_user_functions)
 * jako člen bez role — funkce se volá za každý výskyt tabulky, ke kterému dojde řádek,
 * nezávisle na tom, kolik rozsah vrátí. Fixture prochází všemi větvemi: firma s IČO
 * a druhé dvojče BEZ IČO se jménem, které v dokladech nese jen ta firma.
 *
 * Spouští se přes: node scripts/db/with-throwaway-db.mjs -- npx vitest run <tento soubor>
 */
import { randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { describe, expect, it } from "vitest";
import { PG_HOST, PG_PORT, PG_USER, PG_PASSWORD, PG_DATABASE, isPgReachable } from "./test-env-probe";

const DB_SLIBENA = Boolean(process.env.AISHA_DB_URL);
const RUN = randomUUID().slice(0, 8);
const ICO = `8${RUN.replace(/[^0-9]/g, "").padEnd(7, "3").slice(0, 7)}`;
const JMENO = `Rozsah dvojčat ${RUN} s.r.o.`;
const CLEN = randomUUID();

function psql(sql: string): string {
  return execFileSync(
    "psql",
    // -q: bez hlášek příkazů („INSERT 0 1“ by se přilepilo k id z RETURNING)
    ["-h", PG_HOST, "-p", PG_PORT, "-U", PG_USER, "-d", PG_DATABASE, "-v", "ON_ERROR_STOP=1", "-tAq"],
    { input: `${sql};`, encoding: "utf-8", env: { ...process.env, PGPASSWORD: PG_PASSWORD }, stdio: ["pipe", "pipe", "pipe"] },
  ).trim();
}

/** Počet volání twin_ids_v_rozsahu při jednom resolve jako člen (jedna transakce). */
function volaniRozsahu(parametry: string): number {
  const out = psql(`\\o /dev/null
BEGIN;
SET LOCAL track_functions = 'all';
SET LOCAL request.jwt.claims = '{"sub":"${CLEN}","role":"authenticated"}';
SET LOCAL ROLE authenticated;
SELECT md5(x::text) FROM public.counterparty_resolve('${parametry}'::jsonb) x;
\\o
SELECT coalesce(sum(calls), 0) FROM pg_stat_xact_user_functions WHERE funcname = 'twin_ids_v_rozsahu';
COMMIT`);
  return Number(out.split("\n").filter(Boolean).at(-1));
}

let twinSIco = "";

describe.skipIf(!isPgReachable() && !DB_SLIBENA)("resolve: rozsah dvojčat jen ve sdílených množinách", () => {
  it("příprava: člen s rozsahem (udělené zdroje), firma s IČO, dvojče bez IČO, doklad", () => {
    // Člen musí dvojčata i doklad VIDĚT — jinak RLS odřízne řádky dřív, než dojde
    // na další výskyty, a počet by nerozlišil starou verzi od nové (měřilo by prázdno).
    // Klíč @instance = `druh/instance` (druh z _marker před tečkou) → grant instance:money/…
    psql(`INSERT INTO aisha_auth.users (id, email) VALUES ('${CLEN}', 'rozsah-${RUN}@test.local')`);
    twinSIco = psql(`INSERT INTO public.twin_entities (entity_type, label) VALUES ('company', 'Firma ${RUN}') RETURNING id`);
    const twinJmeno = psql(`INSERT INTO public.twin_entities (entity_type, label) VALUES ('company', '${JMENO}') RETURNING id`);
    psql(`INSERT INTO public.twin_external_refs (twin_id, source, source_key, ref_kind, state, proposed_by, confirmed_at)
          VALUES ('${twinSIco}', 'test', '${ICO}', 'company_ico', 'confirmed', 'test', now())`);
    // Dvojče bez IČO nese NAVRŽENÝ název (jako na riq); výsledek resolve to nemění
    // (schválený název = confirmed).
    psql(`INSERT INTO public.twin_external_refs (twin_id, source, source_key, ref_kind, state, proposed_by)
          VALUES ('${twinJmeno}', 'test', '${JMENO}', 'company_name', 'proposed', 'test')`);
    psql(`INSERT INTO public.twin_events (event_type, twin_id, occurred_at, source) VALUES
          ('parameter', '${twinSIco}', now(), 'rz-${RUN}'), ('parameter', '${twinJmeno}', now(), 'rz-${RUN}')`);
    psql(`INSERT INTO public.li_source_registry (source_sha256, doc_slug, doc_type, doc_class, fields, raw_data)
          VALUES ('rz-${RUN}', 'rz-${RUN}', 'invoice', 'transactional', jsonb_build_object(
            'counterparty_id', jsonb_build_object('value', '${ICO}'),
            'counterparty',    jsonb_build_object('value', '${JMENO}')),
            jsonb_build_object('source_record', jsonb_build_object('_instance', 'RZ-${RUN}', '_marker', 'money.faktura_vydana')))`);
    psql(`INSERT INTO public.data_source_grants (user_id, zdroj) VALUES
          ('${CLEN}', 'udalosti:rz-${RUN}'), ('${CLEN}', 'instance:money/RZ-${RUN}')`);
  });

  it("člen má firmu v rozsahu: resolve vrátí IČO, jméno z dokladu i obě dvojčata", () => {
    const r = psql(`\\o /dev/null
BEGIN;
SET LOCAL request.jwt.claims = '{"sub":"${CLEN}","role":"authenticated"}';
SET LOCAL ROLE authenticated;
\\o
SELECT icos::text || '|' || names::text || '|' || jsonb_array_length(twins)
  FROM public.counterparty_resolve('{"debtor":"${ICO}"}'::jsonb);
COMMIT`);
    expect(r.split("\n").filter(Boolean).at(-1)).toBe(`{${ICO}}|{"${JMENO}"}|2`);
  });

  // Vstup dlužník: na riq stará verze 4×, nová 3× — rozdíl dělají reálná data (stovky
  // firem, dvojčata s vazbami), které malá fixture nenapodobí: tady vyjdou OBĚ verze 3×
  // (diagnostika 2026-09-30). Asserce je proto HORNÍ MEZ proti budoucí regresi, ne důkaz
  // přestavby — ten nese vstup dvojče níž (stará verze na téže fixture 6×, test PADÁ).
  it("vstup dlužník (IČO): rozsah dvojčat nejvýš 3×", () => {
    expect(volaniRozsahu(`{"debtor":"${ICO}"}`)).toBeLessThanOrEqual(3);
  });

  // Kontrolní vzorek 2026-09-30: tentýž test proti staré verzi (riq/main ac5b9528a) padá
  // „expected 6 to be ≤ 5“ — asserce rozlišuje (na riq stará 8×, nová 5×).
  it("vstup dvojče: rozsah dvojčat nejvýš 5×", () => {
    expect(volaniRozsahu(`{"twin_id":"${twinSIco}"}`)).toBeLessThanOrEqual(5);
  });

  it("kontrolní vzorek: měřidlo počítá — přímý dotaz na dvě tabulky dvojčat = 2 volání", () => {
    const out = psql(`\\o /dev/null
BEGIN;
SET LOCAL track_functions = 'all';
SET LOCAL request.jwt.claims = '{"sub":"${CLEN}","role":"authenticated"}';
SET LOCAL ROLE authenticated;
SELECT count(*) FROM public.twin_entities t WHERE t.id = '${twinSIco}';
SELECT count(*) FROM public.twin_external_refs r WHERE r.twin_id = '${twinSIco}';
\\o
SELECT coalesce(sum(calls), 0) FROM pg_stat_xact_user_functions WHERE funcname = 'twin_ids_v_rozsahu';
COMMIT`);
    expect(Number(out.split("\n").filter(Boolean).at(-1))).toBe(2);
  });

  it("týž výsledek bez RLS (služba): firma, jméno z dokladu i obě dvojčata", () => {
    const r = psql(`SELECT icos::text || '|' || names::text || '|' || jsonb_array_length(twins)
                      FROM public.counterparty_resolve('{"debtor":"${ICO}"}'::jsonb)`);
    expect(r).toBe(`{${ICO}}|{"${JMENO}"}|2`);
  });
});
