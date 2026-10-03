/**
 * Brána: generické čtení veličin nad dvojčaty měří to, co deklaruje KATALOG —
 * a když měřit nemá z čeho, řekne to místo aby vymyslelo nulu.
 *
 * ⛔ PROČ VZNIKLA: do 09/2026 se každá otázka nad flotilou psala jako vlastní
 * funkce (šest `get_fleet_*` se jmény událostí, atributů a limitů uvnitř jádra).
 * Tahle trojice masek čte podle `twin_parameter_definitions`, takže další doména
 * je ŘÁDEK V KATALOGU. Test proto nikde nejmenuje vozidlo ani jízdu jako pojem
 * jádra — používá je jen jako DATA fixtury, přesně jako to udělá instance.
 *
 * CO SE MĚŘÍ (vlastnosti, ne pravopis):
 *   1. katalog rozhoduje, kde hodnota leží — tvar `attr` i tvar `{code,value}`;
 *   2. okno od–do je VČETNĚ dne „do" (týden 17.–23. nesmí zahodit poslední den);
 *   3. `ratio` je VÁŽENÝ poměr Σa/Σb, ne průměr poměrů — diferenčně proti `avg`,
 *      protože právě tím se lišila stará čtečka spotřeby;
 *   4. NEMĚŘENO ≠ nula: neznámý parametr, prázdné okno i entita bez hodnoty
 *      vracejí NULL a důvod nesou v `trace_id`, ne v datech;
 *   5. rozdíl dvou veličin (Δ) je jeden sloupec a počítá se až v masce;
 *   6. jednotku parametru určuje katalog (s → h, kg → t) a zaokrouhluje se
 *      JEDNOU, až hotový agregát — po hodnotách by se u týdenního výkazu
 *      nasčítaly minuty a limit 561/2006 by se posoudil podle zaokrouhlení;
 *   7. fail-closed: kdo nemá právo na substrát, nedostane číslo (RLS, ne funkce).
 */
import { describe, it, expect, beforeAll } from "vitest";
import { validateBlockData } from "@aisha/surface-blocks";
import { psqlMultiline } from "./validation-utils";
import { isPgReachable, reportTestCapabilities } from "./test-env-probe";

const dbAvailable = isPgReachable();
const ADMIN = "d2000000-1111-4000-8000-0000000ad001";
const PLAIN = "d2000000-2222-4000-8000-0000000pl001".replace("pl001", "b1001");
const T1 = "e2000000-1111-4000-8000-000000000001";
const T2 = "e2000000-2222-4000-8000-000000000002";
const T3 = "e2000000-3333-4000-8000-000000000003";
/** Dvojče JINÉHO druhu, ale s touž událostí: bez něj by se záměna druhu entity
 *  neprojevila (obě varianty by vracely prázdno a test by nic neměřil). */
const T4 = "e2000000-4444-4000-8000-000000000004";

/**
 * Fixtura je ZÁMĚRNĚ nesymetrická: T1 má dvě krátké jízdy, T2 jednu dlouhou.
 * Vážený poměr (Σ l / Σ km) a průměr poměrů po řádcích proto dají JINÉ číslo —
 * bez toho by test prošel i čtečce, která je zamění.
 */
const FIXTURE = `
INSERT INTO aisha_auth.users (id, email) VALUES
  ('${ADMIN}', 'tm-admin@test.local'), ('${PLAIN}', 'tm-plain@test.local')
ON CONFLICT DO NOTHING;
INSERT INTO public.profiles (user_id, email) VALUES
  ('${ADMIN}', 'tm-admin@test.local'), ('${PLAIN}', 'tm-plain@test.local')
ON CONFLICT (user_id) DO NOTHING;
INSERT INTO public.user_roles (user_id, role) VALUES ('${ADMIN}', 'admin') ON CONFLICT DO NOTHING;

INSERT INTO public.twin_parameter_definitions (code, name, entity_type, data_type, unit, source, metadata) VALUES
  ('probe_distance', 'Vzdálenost', 'probe_asset', 'decimal', 'km', 'probe',
   '{"event_type":"probe_ride","attr":"distance"}'::jsonb),
  ('probe_liters',   'Litry',      'probe_asset', 'decimal', 'l',  'probe',
   '{"event_type":"probe_ride","attr":"liters"}'::jsonb),
  ('probe_filled',   'Natankováno','probe_asset', 'decimal', 'l',  'probe',
   '{"event_type":"probe_fill","attr":"liters"}'::jsonb),
  ('probe_plate',    'Značka',     'probe_asset', 'text',    NULL, 'probe',
   '{"shape":"code_value"}'::jsonb),
  -- Převod jednotky deklaruje KATALOG: zdroj posílá sekundy a kilogramy,
  -- parametr je v hodinách a tunách. Kdyby si převáděl každý blok, dvě dlaždice
  -- nad týmž parametrem by mohly ukázat jiné číslo.
  ('probe_hours',    'Doba',       'probe_asset', 'decimal', 'h',  'probe',
   '{"event_type":"probe_ride","attr":"secs","scale_div":3600}'::jsonb),
  ('probe_tons',     'Hmotnost',   'probe_asset', 'decimal', 't',  'probe',
   '{"event_type":"probe_ride","attr":"kg","scale":0.001}'::jsonb),
  ('probe_bad_scale','Vadný převod','probe_asset','decimal', 'km', 'probe',
   '{"event_type":"probe_ride","attr":"distance","scale":"neco"}'::jsonb)
ON CONFLICT (code) DO UPDATE SET metadata = EXCLUDED.metadata;

INSERT INTO public.twin_entities (id, entity_type, label, status) VALUES
  ('${T1}', 'probe_asset', 'Sonda 1', 'active'),
  ('${T2}', 'probe_asset', 'Sonda 2', 'active'),
  ('${T3}', 'probe_asset', 'Sonda 3 bez dat', 'active'),
  ('${T4}', 'probe_vehicle', 'Vůz mimo domenu parametru', 'active')
ON CONFLICT (id) DO NOTHING;

-- T1: 2 × 50 km / 25 l  → 50 l/100 km na řádek
-- T2: 1 × 200 km / 20 l → 10 l/100 km na řádek
-- vážený poměr celkem = 70 l / 300 km × 100 = 23,33; průměr poměrů = 36,67
INSERT INTO public.twin_events (event_type, twin_id, occurred_at, attrs, source, source_ref) VALUES
  ('probe_ride', '${T1}', date_trunc('day', now()) - interval '2 days',
   '{"distance":"50","liters":"25","secs":"3661","kg":"12500"}'::jsonb, 'probe-a', 'r1'),
  ('probe_ride', '${T1}', date_trunc('day', now()) - interval '1 day',
   '{"distance":"50","liters":"25","secs":"3661","kg":"12500"}'::jsonb, 'probe-a', 'r2'),
  ('probe_ride', '${T2}', date_trunc('day', now()) - interval '1 day',
   '{"distance":"200","liters":"20","secs":"3661","kg":"12500"}'::jsonb, 'probe-b', 'r3'),
  -- mimo okno: minulý měsíc (kontrolní vzorek, že okno opravdu ořezává)
  ('probe_ride', '${T1}', now() - interval '40 days',
   '{"distance":"999","liters":"999"}'::jsonb, 'probe-a', 'r4'),
  ('probe_fill', '${T1}', date_trunc('day', now()) - interval '1 day',
   '{"liters":"80"}'::jsonb, 'probe-c', 'f1'),
  -- Tvar {code,value} má v substrátu DOHODNUTÝ typ události 'twin_parameter' —
  -- právě proto ho katalog u tohoto tvaru nemusí deklarovat. Fixtura ho drží
  -- stejný jako produkce, jinak by test měřil jiný svět než ten živý.
  ('twin_parameter', '${T1}', now() - interval '3 days',
   '{"code":"probe_plate","value":"7"}'::jsonb, 'probe-d', 'p1'),
  -- Táž událost na dvojčeti JINÉHO druhu: katalog parametr deklaruje pro
  -- 'probe_asset', tohle je past na čtečku, která by druh jen přebila.
  ('probe_ride', '${T4}', date_trunc('day', now()) - interval '1 day',
   '{"distance":"777","liters":"7"}'::jsonb, 'probe-e', 'r5'),
  -- PEVNÝ okamžik na hranici dne: 22:30 UTC = 00:30 v Praze NÁSLEDUJÍCÍHO dne.
  -- Rozhoduje, jestli den začíná půlnocí v Praze, nebo v Londýně.
  ('probe_ride', '${T1}', timestamptz '2026-07-10 22:30:00+00',
   '{"distance":"42","liters":"4"}'::jsonb, 'probe-a', 'r6')
ON CONFLICT DO NOTHING;
`;

const asUser = (sub: string) => `SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', '{"sub":"${sub}","role":"authenticated"}', true);`;

const kpi = (p: string) => `public.get_twin_metric_kpi_block('${p}'::jsonb)`;
const tbl = (p: string) => `public.get_twin_metric_table_block('${p}'::jsonb)`;
const chart = (p: string) => `public.get_twin_metric_chart_block('${p}'::jsonb)`;

describe("generické veličiny nad dvojčaty: katalog rozhoduje, NEMĚŘENO se přizná", () => {
  beforeAll(() => reportTestCapabilities("twin metric blocks"));

  it.skipIf(!dbAvailable)("součet čte podle katalogu, okno ořezává a den „do\" je včetně", () => {
    const out = psqlMultiline(`
BEGIN;
${FIXTURE}
${asUser(ADMIN)}
SELECT 'soucet=' || (${kpi('{"param":"probe_distance","agg":"sum","entity_type":"probe_asset","days":7}')}->'data'->>'value') AS out;
-- Okno se skládá v SQL, aby test nebyl vázaný na konkrétní datum běhu.
SELECT 'okno=' || (public.get_twin_metric_kpi_block(jsonb_build_object(
          'param', 'probe_distance', 'agg', 'sum', 'entity_type', 'probe_asset',
          'date_from', to_char(current_date - 1, 'YYYY-MM-DD'),
          'date_to',   to_char(current_date - 1, 'YYYY-MM-DD')))->'data'->>'value') AS out;
-- Totéž okno u grafu a tabulky: každý blok si okno skládá sám, takže „den do
-- včetně" se musí měřit u každého zvlášť (mutace bez +1 tu jinak přežila).
SELECT 'okno_graf=' || coalesce((SELECT trim_scale(sum((p->>'value')::numeric))::text
  FROM jsonb_array_elements(public.get_twin_metric_chart_block(jsonb_build_object(
          'param', 'probe_distance', 'entity_type', 'probe_asset', 'kind', 'bar',
          'date_from', to_char(current_date - 1, 'YYYY-MM-DD'),
          'date_to',   to_char(current_date - 1, 'YYYY-MM-DD')))->'data'->'points') p), 'NULL') AS out;
SELECT 'okno_tabulka=' || coalesce((SELECT trim_scale(sum((r->>'km')::numeric))::text
  FROM jsonb_array_elements(public.get_twin_metric_table_block(jsonb_build_object(
          'entity_type', 'probe_asset',
          'columns', '[{"key":"km","param":"probe_distance"}]'::jsonb,
          'date_from', to_char(current_date - 1, 'YYYY-MM-DD'),
          'date_to',   to_char(current_date - 1, 'YYYY-MM-DD')))->'data'->'rows') r), 'NULL') AS out;
SELECT 'vozy=' || (${kpi('{"param":"probe_distance","agg":"count_distinct","entity_type":"probe_asset","days":7}')}->'data'->>'value') AS out;
SELECT 'code_value=' || (${kpi('{"param":"probe_plate","agg":"last","entity_type":"probe_asset","days":7}')}->'data'->>'value') AS out;
SELECT 'zdroj=' || (${kpi('{"param":"probe_distance","agg":"sum","entity_type":"probe_asset","days":7}')}->'provenance'->>'source_slug') AS out;
ROLLBACK;
`);
    // 50 + 50 + 200 = 300; jízda 40 dní stará do okna nepatří
    expect(out, "okno neořezalo starší jízdu — součet by byl 1299").toContain("soucet=300");
    // jediný den (včera): T1 50 + T2 200 = 250 → den „do" musí být včetně
    expect(out, "den „do\" se zahodil — absolutní okno by ukázalo jen 50").toContain("okno=250");
    expect(out, "graf zahodil den „do\" — v okně jediného dne nezbyl žádný sloupec").toContain("okno_graf=250");
    expect(out, "tabulka zahodila den „do\" — v okně jediného dne nezbyla žádná hodnota").toContain("okno_tabulka=250");
    expect(out).toContain("vozy=2");
    expect(out, "tvar {code,value} musí číst tatáž čtečka").toContain("code_value=7");
    expect(out, "provenance se odvozuje z dat, ne z konfigurace").toContain("zdroj=probe-a+probe-b");
  });

  it.skipIf(!dbAvailable)("ratio je vážený poměr, ne průměr poměrů", () => {
    const out = psqlMultiline(`
BEGIN;
${FIXTURE}
${asUser(ADMIN)}
SELECT 'vazeny=' || (${kpi('{"param":"probe_liters","per_param":"probe_distance","agg":"ratio","factor":100,"entity_type":"probe_asset","days":7}')}->'data'->>'value') AS out;
-- Kontrolní vzorek POMĚRU PO ŘÁDCÍCH počítaný mimo čtečku: kdyby ho vracela,
-- obě čísla by se rovnala a test by nic neměřil.
-- Kontrolní vzorek musí měřit TOTÉŽ UNIVERZUM co čtečka: druh entity z katalogu
-- (probe_asset), stejné okno. Jinak by se lišil i tam, kde obě metody souhlasí —
-- naměřeno: bez filtru druhu dal 27.73, protože do něj spadlo dvojče vozu.
SELECT 'prumer_pomeru=' || round(avg((e.attrs->>'liters')::numeric / (e.attrs->>'distance')::numeric * 100), 2)
  FROM public.twin_events e
  JOIN public.twin_entities t ON t.id = e.twin_id
 WHERE e.event_type = 'probe_ride' AND t.entity_type = 'probe_asset'
   AND e.occurred_at >= now() - interval '7 days';
ROLLBACK;
`);
    // 70 l / 300 km × 100 = 23.33 — průměr poměrů po řádcích dá 36.67
    expect(out, "vážený poměr se spočítal jako průměr poměrů").toContain("vazeny=23.33");
    expect(out, "fixtura nerozlišuje obě metody — test by nic neměřil").toContain("prumer_pomeru=36.67");
  });

  it.skipIf(!dbAvailable)("NEMĚŘENO místo nuly: neznámý parametr, prázdné okno, entita bez dat", () => {
    const out = psqlMultiline(`
BEGIN;
${FIXTURE}
${asUser(ADMIN)}
SELECT 'neznamy=' || coalesce((${kpi('{"param":"nic_takoveho","days":7}')}->'data'->>'value'), 'NULL')
    || '/' || (${kpi('{"param":"nic_takoveho","days":7}')}->'provenance'->>'trace_id') AS out;
SELECT 'prazdno=' || coalesce((${kpi('{"param":"probe_distance","entity_type":"probe_asset","date_from":"2020-01-01","date_to":"2020-01-02"}')}->'data'->>'value'), 'NULL')
    || '/' || (${kpi('{"param":"probe_distance","entity_type":"probe_asset","date_from":"2020-01-01","date_to":"2020-01-02"}')}->'provenance'->>'trace_id') AS out;
-- Počítadlo nad prázdnem: 0 by tvrdila „žádné vozidlo nejelo" tam, kde jen
-- nikdo neměří. Kontrolní vzorek je 'vozy=2' výš — nad daty počítadlo počítá.
SELECT 'pocitadlo_prazdno=' || coalesce((${kpi('{"param":"probe_distance","agg":"count_distinct","entity_type":"probe_asset","date_from":"2020-01-01","date_to":"2020-01-02"}')}->'data'->>'value'), 'NULL')
    || '/' || (${kpi('{"param":"probe_distance","agg":"count_distinct","entity_type":"probe_asset","date_from":"2020-01-01","date_to":"2020-01-02"}')}->'provenance'->>'trace_id') AS out;
SELECT 'bez_param=' || coalesce((${kpi('{"agg":"sum"}')}->'data'->>'value'), 'NULL')
    || '/' || (${kpi('{"agg":"sum"}')}->'provenance'->>'trace_id') AS out;
SELECT 'radek_bez_dat=' || coalesce((
  SELECT r->>'km' FROM jsonb_array_elements(${tbl('{"entity_type":"probe_asset","days":7,"columns":[{"key":"km","param":"probe_distance"}]}')}->'data'->'rows') r
   WHERE r->>'label' = 'Sonda 3 bez dat'), 'NULL') AS out;
ROLLBACK;
`);
    expect(out).toContain("neznamy=NULL/twin-metric-kpi:nic_takoveho:sum:unknown_param");
    expect(out).toContain("prazdno=NULL/twin-metric-kpi:probe_distance:sum:no_data");
    expect(out).toContain("bez_param=NULL/twin-metric-kpi:missing_config");
    expect(out, "počítadlo nad prázdnou množinou vrátilo nulu místo NEMĚŘENO")
      .toContain("pocitadlo_prazdno=NULL/twin-metric-kpi:probe_distance:count_distinct:no_data");
    expect(out, "entita bez hodnoty musí zůstat prázdná, ne nulová").toContain("radek_bez_dat=NULL");
  });

  // `->>'value'` nerozliší CHYBĚJÍCÍ klíč od null — oba dají NULL. Shell ale
  // měří tvar maskou kpi_tile, kde je `value` povinné: dlaždice bez klíče zmizí
  // z plochy beze slova (produkce 2026-09-24, 7/7 dlaždic vozového parku).
  // Proto se každá cesta dlaždice měří TOUŽ maskou, jakou měří prohlížeč.
  it.skipIf(!dbAvailable)("každá cesta dlaždice projde maskou kpi_tile — i NEMĚŘENO", () => {
    const cesty: Record<string, string> = {
      s_hodnotou: '{"param":"probe_distance","agg":"sum","entity_type":"probe_asset","days":7}',
      srovnani: '{"param":"probe_distance","agg":"sum","entity_type":"probe_asset","days":7,"compare":"previous","unit_key":"app.units.km"}',
      bez_dat: '{"param":"probe_distance","entity_type":"probe_asset","date_from":"2020-01-01","date_to":"2020-01-02"}',
      pocitadlo_bez_dat: '{"param":"probe_distance","agg":"count_distinct","entity_type":"probe_asset","date_from":"2020-01-01","date_to":"2020-01-02"}',
      neznamy_param: '{"param":"nic_takoveho","days":7}',
      bez_konfigurace: '{"agg":"sum"}',
    };
    const out = psqlMultiline(`
BEGIN;
${FIXTURE}
${asUser(ADMIN)}
${Object.entries(cesty)
  .map(([k, p]) => `SELECT '${k}=' || (${kpi(p)}->'data')::text AS out;`)
  .join("\n")}
ROLLBACK;
`);
    for (const k of Object.keys(cesty)) {
      const radek = out.split("\n").find((l) => l.trim().startsWith(`${k}=`));
      expect(radek, `cesta ${k} nic nevrátila`).toBeDefined();
      const data = JSON.parse(radek!.trim().slice(k.length + 1));
      expect(Object.keys(data), `cesta ${k}: klíč value chybí — shell dlaždici zahodí`).toContain("value");
      const v = validateBlockData(data);
      expect(v.ok ? v.mask : `${v.mask}: ${v.errors.join(" · ")}`, `cesta ${k} neprošla maskou`).toBe("kpi_tile");
    }
  });

  // Graf skládá `data` doslovně (brána block-data-keys-fit-contract čte klíče ze
  // zdroje) a volitelný unit_key odebírá, když chybí: kontrakt chartu ho zná jen
  // jako ŘETĚZEC, takže `"unit_key": null` by maska odmítla a blok by z plochy
  // zmizel. Dřív to kryl obal jsonb_strip_nulls — tohle tvrzení drží, že jeho
  // odstranění nic nepustilo ven.
  it.skipIf(!dbAvailable)("každá cesta grafu projde maskou chart — s jednotkou i bez", () => {
    const cesty: Record<string, { p: string; jednotka: string | null; body: boolean }> = {
      bar_bez_jednotky: { p: '{"param":"probe_distance","agg":"sum","entity_type":"probe_asset","kind":"bar","days":7}', jednotka: null, body: true },
      bar_s_jednotkou: { p: '{"param":"probe_distance","agg":"sum","entity_type":"probe_asset","kind":"bar","days":7,"unit_key":"app.units.km"}', jednotka: "app.units.km", body: true },
      bar_s_poznamkou: { p: '{"param":"probe_distance","agg":"sum","entity_type":"probe_asset","kind":"bar","days":7,"note_param":"probe_liters"}', jednotka: null, body: true },
      trend_bez_jednotky: { p: '{"param":"probe_distance","agg":"sum","entity_type":"probe_asset","kind":"trend","days":30}', jednotka: null, body: true },
      trend_s_jednotkou: { p: '{"param":"probe_distance","agg":"sum","entity_type":"probe_asset","kind":"trend","days":30,"unit_key":"app.units.km"}', jednotka: "app.units.km", body: true },
      bez_dat: { p: '{"param":"probe_distance","entity_type":"probe_asset","date_from":"2020-01-01","date_to":"2020-01-02"}', jednotka: null, body: false },
      bez_konfigurace: { p: '{"agg":"sum"}', jednotka: null, body: false },
    };
    const out = psqlMultiline(`
BEGIN;
${FIXTURE}
${asUser(ADMIN)}
${Object.entries(cesty)
  .map(([k, c]) => `SELECT '${k}=' || (${chart(c.p)}->'data')::text AS out;`)
  .join("\n")}
ROLLBACK;
`);
    for (const [k, c] of Object.entries(cesty)) {
      const radek = out.split("\n").find((l) => l.trim().startsWith(`${k}=`));
      expect(radek, `cesta ${k} nic nevrátila`).toBeDefined();
      const data = JSON.parse(radek!.trim().slice(k.length + 1));
      if (c.jednotka === null) {
        expect(Object.keys(data), `cesta ${k}: unit_key bez jednotky má CHYBĚT, ne být null`).not.toContain("unit_key");
      } else {
        expect(data.unit_key, `cesta ${k}: jednotka se ztratila`).toBe(c.jednotka);
      }
      // Cesta s daty musí body opravdu nést — jinak by maska prošla nad prázdnem.
      if (c.body) expect(data.points.length, `cesta ${k}: fixture nedala body`).toBeGreaterThan(0);
      const v = validateBlockData(data);
      expect(v.ok ? v.mask : `${v.mask}: ${v.errors.join(" · ")}`, `cesta ${k} neprošla maskou`).toBe("chart");
    }
  });

  it.skipIf(!dbAvailable)("tabulka: rozdíl dvou veličin je jeden sloupec, řádek nese identitu", () => {
    const out = psqlMultiline(`
BEGIN;
${FIXTURE}
${asUser(ADMIN)}
SELECT 'delta=' || coalesce((
  SELECT r->>'delta' FROM jsonb_array_elements(${tbl(
    '{"entity_type":"probe_asset","days":7,"columns":[{"key":"natankovano","param":"probe_filled"},{"key":"spotreba","param":"probe_liters"},{"key":"delta","param":"probe_filled","minus_param":"probe_liters"}]}',
  )}->'data'->'rows') r WHERE r->>'label' = 'Sonda 1'), 'NULL') AS out;
SELECT 'id_radku=' || coalesce((
  SELECT r->>'id' FROM jsonb_array_elements(${tbl('{"entity_type":"probe_asset","days":7,"columns":[{"key":"km","param":"probe_distance"}]}')}->'data'->'rows') r
   WHERE r->>'label' = 'Sonda 1'), 'NULL') AS out;
SELECT 'kdy_naposledy=' || coalesce((
  SELECT r->>'kdy' FROM jsonb_array_elements(${tbl('{"entity_type":"probe_asset","days":7,"columns":[{"key":"kdy","param":"probe_distance","as":"last_at"}]}')}->'data'->'rows') r
   WHERE r->>'label' = 'Sonda 2'), 'NULL') AS out;
SELECT 'ocekavane_kdy=' || to_char(date_trunc('day', now()) - interval '1 day', 'YYYY-MM-DD') AS out;
SELECT 'jen_s_daty=' || jsonb_array_length(${tbl('{"entity_type":"probe_asset","days":7,"only_with_data":true,"columns":[{"key":"km","param":"probe_distance"}]}')}->'data'->'rows') AS out;
SELECT 'vsechny=' || jsonb_array_length(${tbl('{"entity_type":"probe_asset","days":7,"columns":[{"key":"km","param":"probe_distance"}]}')}->'data'->'rows') AS out;
ROLLBACK;
`);
    // T1: natankováno 80 − spotřeba 50 = 30
    expect(out, "Δ se nespočítalo z obou stran").toContain("delta=30");
    expect(out, "řádek bez identity nejde otevřít").toContain(`id_radku=${T1}`);
    expect(out).toContain("jen_s_daty=2");
    expect(out, "registr entit má být vidět celý, včetně neměřených").toContain("vsechny=3");
    // Sloupec `as:"last_at"` nese ČAS poslední hodnoty, ne její velikost —
    // bez něj by seznam odstavených uměl říct „kolik dní", ale ne „od kdy".
    const kdy = /kdy_naposledy=(\S+)/.exec(out)?.[1];
    const ocekavane = /ocekavane_kdy=(\S+)/.exec(out)?.[1];
    expect(kdy, "sloupec „kdy naposledy\" nevrátil datum").toBe(ocekavane);
  });

  it.skipIf(!dbAvailable)("graf: body bez hodnoty se nekreslí, poznámka nese druhou veličinu", () => {
    const out = psqlMultiline(`
BEGIN;
${FIXTURE}
${asUser(ADMIN)}
SELECT 'bodu=' || jsonb_array_length(${chart('{"param":"probe_distance","entity_type":"probe_asset","days":7,"kind":"bar"}')}->'data'->'points') AS out;
SELECT 'prvni=' || (${chart('{"param":"probe_distance","entity_type":"probe_asset","days":7,"kind":"bar"}')}->'data'->'points'->0->>'label') AS out;
-- Graf litrů se řadí podle LITRŮ: první je Sonda 1 (50 l), druhá Sonda 2 (20 l).
-- Poznámka musí nést PRŮMĚRNOU TRASU TÉŽE sondy (50 km vs. 200 km) — kdyby se
-- počítala přes celou flotilu, obě poznámky by byly stejné (100) a test by
-- neodlišil poznámku po entitě od poznámky celkové.
SELECT 'poznamka_1=' || coalesce((${chart('{"param":"probe_liters","entity_type":"probe_asset","days":7,"kind":"bar","note_param":"probe_distance","note_agg":"avg"}')}->'data'->'points'->0->>'label'), '?')
    || '/' || coalesce((${chart('{"param":"probe_liters","entity_type":"probe_asset","days":7,"kind":"bar","note_param":"probe_distance","note_agg":"avg"}')}->'data'->'points'->0->>'note'), 'NULL') AS out;
SELECT 'poznamka_2=' || coalesce((${chart('{"param":"probe_liters","entity_type":"probe_asset","days":7,"kind":"bar","note_param":"probe_distance","note_agg":"avg"}')}->'data'->'points'->1->>'label'), '?')
    || '/' || coalesce((${chart('{"param":"probe_liters","entity_type":"probe_asset","days":7,"kind":"bar","note_param":"probe_distance","note_agg":"avg"}')}->'data'->'points'->1->>'note'), 'NULL') AS out;
SELECT 'trend=' || jsonb_array_length(${chart('{"param":"probe_distance","entity_type":"probe_asset","days":7,"kind":"trend","bucket":"day"}')}->'data'->'points') AS out;
-- Trend s POMĚREM: jmenovatel se musí spočítat po obdobích. Chyba v téhle
-- větvi se neprojeví při vytvoření funkce, až při prvním volání.
SELECT 'trend_pomer=' || (${chart('{"param":"probe_liters","per_param":"probe_distance","agg":"ratio","factor":100,"entity_type":"probe_asset","days":7,"kind":"trend","bucket":"day"}')}->'data'->'points'->0->>'value') AS out;
ROLLBACK;
`);
    expect(out, "sonda bez dat se nesmí kreslit jako nulový sloupec").toContain("bodu=2");
    expect(out, "sloupce se řadí od největší hodnoty").toContain("prvni=Sonda 2");
    expect(out, "poznámka nesedí na entitu sloupce").toContain("poznamka_1=Sonda 1/50");
    expect(out, "poznámka je pro obě entity stejná — počítá se přes celek").toContain("poznamka_2=Sonda 2/200");
    expect(out, "trend má mít bod za každý den s daty").toContain("trend=2");
    // Nejstarší den v okně: T1 jel 50 km na 25 l → 50 l/100 km (body jdou od
    // nejstaršího). Vážený poměr se počítá V RÁMCI období, ne přes celé okno.
    expect(out, "trend s poměrem musí dělit jmenovatelem TÉHOŽ období").toContain("trend_pomer=50");
  });

  it.skipIf(!dbAvailable)("jednotku parametru určuje katalog a zaokrouhluje se JEDNOU", () => {
    const out = psqlMultiline(`
BEGIN;
${FIXTURE}
${asUser(ADMIN)}
SELECT 'hodiny=' || (${kpi('{"param":"probe_hours","agg":"sum","entity_type":"probe_asset","days":7}')}->'data'->>'value') AS out;
SELECT 'tuny=' || (${kpi('{"param":"probe_tons","agg":"sum","entity_type":"probe_asset","days":7}')}->'data'->>'value') AS out;
SELECT 'vadny_prevod=' || (${kpi('{"param":"probe_bad_scale","agg":"sum","entity_type":"probe_asset","days":7}')}->'data'->>'value') AS out;
SELECT 'tabulka_hodiny=' || coalesce((
  SELECT r->>'h' FROM jsonb_array_elements(${tbl('{"entity_type":"probe_asset","days":7,"columns":[{"key":"h","param":"probe_hours"}]}')}->'data'->'rows') r
   WHERE r->>'label' = 'Sonda 1'), 'NULL') AS out;
ROLLBACK;
`);
    // 3 × 3661 s = 10 983 s = 3,050833… h → 3.05.
    // ⭐ Kdyby se zaokrouhlovala každá HODNOTA (1,02 h), součet by dal 3.06 —
    //    a u týdenního výkazu proti limitu 56 h se takhle nasčítají minuty.
    expect(out, "zaokrouhlilo se po hodnotách, ne až agregát").toContain("hodiny=3.05");
    // 3 × 12 500 kg × 0,001 = 37,5 t — a bez koncové nuly
    expect(out, "násobný převod (kg → t) se neprojevil").toContain("tuny=37.5");
    // Nečíselný převod se ignoruje: 300 km zůstane 300 km, blok nespadne
    expect(out, "překlep v katalogu nesmí změnit ani shodit číslo").toContain("vadny_prevod=300");
    // 2 × 3661 s = 7322 s = 2,0339 h → 2.03 (tatáž cesta i v tabulce)
    expect(out, "tabulka a dlaždice musí číst tutéž jednotku").toContain("tabulka_hodiny=2.03");
  });

  it.skipIf(!dbAvailable)("druh entity jde ZÚŽIT, ne zaměnit; den začíná v pásmu bloku", () => {
    const out = psqlMultiline(`
BEGIN;
${FIXTURE}
${asUser(ADMIN)}
SELECT 'domena=' || coalesce((${kpi('{"param":"probe_distance","agg":"sum","entity_type":"probe_asset","days":7}')}->'data'->>'value'), 'NULL') AS out;
SELECT 'cizi_druh=' || coalesce((${kpi('{"param":"probe_distance","agg":"sum","entity_type":"probe_vehicle","days":7}')}->'data'->>'value'), 'NULL') AS out;
SELECT 'praha=' || coalesce((${kpi('{"param":"probe_distance","agg":"sum","entity_type":"probe_asset","date_from":"2026-07-11","date_to":"2026-07-11","tz":"Europe/Prague"}')}->'data'->>'value'), 'NULL') AS out;
SELECT 'utc=' || coalesce((${kpi('{"param":"probe_distance","agg":"sum","entity_type":"probe_asset","date_from":"2026-07-11","date_to":"2026-07-11"}')}->'data'->>'value'), 'NULL') AS out;
SELECT 'nesmyslne_pasmo=' || coalesce((${kpi('{"param":"probe_distance","agg":"sum","entity_type":"probe_asset","date_from":"2026-07-11","date_to":"2026-07-11","tz":"Marsu/Olympus"}')}->'data'->>'value'), 'NULL') AS out;
ROLLBACK;
`);
    // Katalog deklaruje parametr pro 'probe_asset'. Jízda vozu (777 km) do
    // součtu NESMÍ vstoupit ani tehdy, když si o ten druh blok výslovně řekne.
    expect(out, "součet se rozešel s doménou parametru").toContain("domena=300");
    expect(out, "blok si vyžádal cizí druh entity a čtečka mu ho dala")
      .toContain("cizi_druh=NULL");
    // Jízda v 00:30 pražského času 11. 7. patří do 11. 7., ne do 10. 7.
    expect(out, "den nezačíná půlnocí v pásmu bloku").toContain("praha=42");
    expect(out, "v UTC ta jízda do 11. 7. nepatří — kdyby ano, pásmo se neuplatnilo")
      .toContain("utc=NULL");
    expect(out, "překlep v pásmu má degradovat na UTC, ne vyrobit jiné okno")
      .toContain("nesmyslne_pasmo=NULL");
  });

  // Registr entit (`get_twin_register`) čte TÝŽ katalog: sloupec je jen to, co
  // má „poslední hodnotu". Záznam událostí (event_log) ji nemá — v produkci RIQ
  // z něj byly čtyři sloupce navždy prázdné. Časová řada v atributu události
  // (hladina) ji má a čte se švem, ne jako {code,value}.
  it.skipIf(!dbAvailable)("registr: sloupce určuje katalog, časová řada ukáže poslední hodnotu", () => {
    const out = psqlMultiline(`
BEGIN;
${FIXTURE}
UPDATE public.twin_parameter_definitions SET historization = 'event_log'
 WHERE code IN ('probe_distance', 'probe_liters');
INSERT INTO public.twin_parameter_definitions (code, name, entity_type, data_type, unit, source, historization, metadata) VALUES
  ('probe_level', 'Hladina', 'probe_asset', 'decimal', 'l', 'probe', 'timeseries',
   '{"event_type":"probe_state","attr":"level"}'::jsonb)
ON CONFLICT (code) DO UPDATE SET metadata = EXCLUDED.metadata, historization = EXCLUDED.historization;
INSERT INTO public.twin_events (event_type, twin_id, occurred_at, attrs, source, source_ref) VALUES
  ('probe_state', '${T1}', now() - interval '2 hours', '{"level":"80"}'::jsonb, 'probe-s', 's1'),
  ('probe_state', '${T1}', now() - interval '1 hour',  '{"level":"42.50"}'::jsonb, 'probe-s', 's2')
ON CONFLICT DO NOTHING;
${asUser(ADMIN)}
SELECT 'sloupce=' || (SELECT string_agg(c->>'key', ',' ORDER BY c->>'key')
  FROM jsonb_array_elements(public.get_twin_register('{"entity_type":"probe_asset"}'::jsonb)->'data'->'columns') c) AS out;
SELECT 'hladina_t1=' || coalesce((SELECT r->>'probe_level'
  FROM jsonb_array_elements(public.get_twin_register('{"entity_type":"probe_asset"}'::jsonb)->'data'->'rows') r
 WHERE r->>'id' = '${T1}'), 'NULL') AS out;
SELECT 'znacka_t1=' || coalesce((SELECT r->>'probe_plate'
  FROM jsonb_array_elements(public.get_twin_register('{"entity_type":"probe_asset"}'::jsonb)->'data'->'rows') r
 WHERE r->>'id' = '${T1}'), 'NULL') AS out;
ROLLBACK;
`);
    const sloupce = (out.match(/sloupce=([^\n]*)/)?.[1] ?? "").split(",");
    expect(sloupce, "záznam událostí nemá poslední hodnotu — do registru nepatří").not.toContain("probe_distance");
    expect(sloupce).not.toContain("probe_liters");
    expect(sloupce, "časová řada do registru patří").toContain("probe_level");
    expect(sloupce, "atribut {code,value} zůstává").toContain("probe_plate");
    expect(out, "registr neukázal POSLEDNÍ hodnotu časové řady").toContain("hladina_t1=42.5");
    expect(out, "atribut {code,value} se čte dál").toContain("znacka_t1=7");
  });

  it.skipIf(!dbAvailable)("fail-closed: bez práva na substrát není číslo", () => {
    const out = psqlMultiline(`
BEGIN;
${FIXTURE}
${asUser(PLAIN)}
SELECT 'bez_prava=' || coalesce((${kpi('{"param":"probe_distance","agg":"sum","entity_type":"probe_asset","days":7}')}->'data'->>'value'), 'NULL') AS out;
SELECT 'tabulka=' || jsonb_array_length(${tbl('{"entity_type":"probe_asset","days":7,"columns":[{"key":"km","param":"probe_distance"}]}')}->'data'->'rows') AS out;
ROLLBACK;
`);
    expect(out, "bez práva NESMÍ vrátit číslo — to by obešlo RLS").toContain("bez_prava=NULL");
    expect(out, "ani registr entit se nesmí vydat bez práva").toContain("tabulka=0");
  });
});
