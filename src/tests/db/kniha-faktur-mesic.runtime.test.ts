/**
 * Kniha faktur za měsíc — get_rent_breakdown s obdobím (RUNTIME, throwaway DB).
 *
 * Majitel 2026-09-29 (náčrt „Smlouvy a nájmy v2", bod 3): klienti za MĚSÍC
 * s rozpadem N/E/P. Dřív rozpad sčítal celou historii a faktura BEZ položek
 * zmizela úplně (cross join přes položky) — naměřeno 29. 9.: vydaných bez
 * položek 10 822, s položkami 5 797.
 *
 * Měří se chování:
 *   - `mesic` (volba klienta) počítá jen ten měsíc; KONTROLNÍ VZOREK: bez období
 *     se sčítá celá historie (dosavadní chování nezmizelo);
 *   - `obdobi_vychozi: aktualni_mesic` (konfigurace) = tento měsíc; `mesic` ho přebije;
 *   - faktura bez položek jde do „bez rozpisu" částkou z hlavičky, ne 0 a ne „ostatní";
 *   - `document_subtype` z konfigurace (kniha = vydané) vynechá přijaté;
 *   - `jen_tridy` nechá jen klienty s částkou v té třídě;
 *   - neznámé `obdobi_vychozi` / neplatný `mesic` = chyba 22023, ne tichá historie;
 *   - provenance.coverage = kolik řádků stojí na IČO.
 *
 * Spouští se přes: npm run test:db:pohledavka
 */
import { describe, expect, it } from "vitest";
import { psqlMultiline } from "./validation-utils";
import { isPgReachable } from "./test-env-probe";

const DB_SLIBENA = Boolean(process.env.AISHA_DB_URL);
const HEADER = "\\set ON_ERROR_STOP on\n";
const ICO = "92000001";
const ICO_E = "92000002";
const TRIDY = `"classes":[{"key":"E","pattern":"energi"},{"key":"N","pattern":"nájem"},{"key":"P","pattern":"služb"}]`;

const seed = `
  CREATE OR REPLACE FUNCTION pg_temp.fa(
    p_sha text, p_ico text, p_jmeno text, p_den date, p_total text, p_polozky jsonb, p_druh text DEFAULT 'issued'
  ) RETURNS void LANGUAGE sql AS $f$
    INSERT INTO public.li_source_registry
      (source_sha256, doc_slug, doc_type, filename, status, fields, line_items)
    VALUES (p_sha, 'slug-'||p_sha, 'invoice', 'fa-'||p_sha||'.json', 'AUTO_PASS',
      jsonb_strip_nulls(jsonb_build_object(
        'counterparty_id',  CASE WHEN p_ico IS NULL THEN NULL ELSE jsonb_build_object('value', p_ico) END,
        'counterparty',     jsonb_build_object('value', p_jmeno),
        'document_subtype', jsonb_build_object('value', p_druh),
        'owner_company',    jsonb_build_object('value', 'Kniha test firma'),
        'issue_date',       jsonb_build_object('value', p_den::text),
        'total_amount',     jsonb_build_object('value', p_total))),
      p_polozky);
  $f$;
  CREATE OR REPLACE FUNCTION pg_temp.pol(p_nazev text, p_castka text) RETURNS jsonb LANGUAGE sql AS $f$
    SELECT jsonb_build_object('fields', jsonb_build_object(
      'item_name', jsonb_build_object('value', p_nazev), 'line_total', jsonb_build_object('value', p_castka)));
  $f$;

  -- tento měsíc: nájem 1000 + energie 300 (s položkami) a jedna faktura BEZ položek 450
  PERFORM pg_temp.fa('kf-1', '${ICO}', 'KNIHA TEST s.r.o.', date_trunc('month', current_date)::date + 1, '1300',
          jsonb_build_array(pg_temp.pol('nájem prostor', '1000'), pg_temp.pol('energie záloha', '300')));
  PERFORM pg_temp.fa('kf-2', '${ICO}', 'KNIHA TEST s.r.o.', date_trunc('month', current_date)::date + 2, '450', '[]'::jsonb);
  -- minulý měsíc: nájem 1000
  PERFORM pg_temp.fa('kf-3', '${ICO}', 'KNIHA TEST s.r.o.', (date_trunc('month', current_date) - interval '1 month')::date + 3, '1000',
          jsonb_build_array(pg_temp.pol('nájem prostor', '1000')));
  -- přijatá faktura tento měsíc (náš náklad) — kniha vydaných ji nesmí započítat
  PERFORM pg_temp.fa('kf-4', '${ICO}', 'KNIHA TEST s.r.o.', date_trunc('month', current_date)::date + 3, '9999',
          jsonb_build_array(pg_temp.pol('nájem prostor', '9999')), 'received');
  -- jiný klient jen s energií tento měsíc, a klient BEZ IČO jen se službou
  PERFORM pg_temp.fa('kf-5', '${ICO_E}', 'ENERGIE TEST s.r.o.', date_trunc('month', current_date)::date + 4, '200',
          jsonb_build_array(pg_temp.pol('energie elektřina', '200')));
  PERFORM pg_temp.fa('kf-6', NULL, 'Kniha Osoba', date_trunc('month', current_date)::date + 5, '50',
          jsonb_build_array(pg_temp.pol('služby úklid', '50')));
`;

function spust(telo: string): () => string {
  return () =>
    psqlMultiline(`${HEADER}
BEGIN;
DO $$
DECLARE v jsonb; b jsonb; n numeric; t text;
BEGIN
  PERFORM set_config('request.jwt.claims', '{"role":"service_role"}', true);
${seed}
${telo}
END $$;
ROLLBACK;
`);
}

const radek = (id: string, pole: string) =>
  `(SELECT r->>'${pole}' FROM jsonb_array_elements(v) r WHERE r->>'id' = '${id}')`;
const kniha = (params: string) =>
  `b := public.get_rent_breakdown('{${TRIDY},"document_subtype":"issued","limit":500${params ? "," + params : ""}}'::jsonb); v := b->'data'->'rows';`;

describe.skipIf(!isPgReachable() && !DB_SLIBENA)("kniha faktur za měsíc", () => {
  it("tento měsíc: nájem, energie, bez rozpisu z hlavičky; přijatá faktura mimo; celkem a počet dokladů", () => {
    expect(
      spust(`
  b := public.get_rent_breakdown(jsonb_build_object('classes', '[{"key":"E","pattern":"energi"},{"key":"N","pattern":"nájem"},{"key":"P","pattern":"služb"}]'::jsonb,
         'document_subtype','issued', 'limit',500, 'mesic', date_trunc('month', current_date)::date::text));
  v := b->'data'->'rows';
  IF ${radek(ICO, "trida_N")} IS DISTINCT FROM '1000' THEN RAISE 'nájem tento měsíc: %', v; END IF;
  IF ${radek(ICO, "trida_E")} IS DISTINCT FROM '300' THEN RAISE 'energie: %', v; END IF;
  IF ${radek(ICO, "bez_rozpisu")} IS DISTINCT FROM '450' THEN RAISE 'bez rozpisu: %', v; END IF;
  IF ${radek(ICO, "celkem")} IS DISTINCT FROM '1750' THEN RAISE 'celkem (1000+300+450, bez přijaté 9999): %', v; END IF;
  IF ${radek(ICO, "dokladu")} IS DISTINCT FROM '2' THEN RAISE 'dokladů: %', v; END IF;
`),
    ).not.toThrow();
  });

  it("KONTROLNÍ VZOREK: bez období celá historie; minulý měsíc zvlášť", () => {
    expect(
      spust(`
  ${kniha("")}
  IF ${radek(ICO, "trida_N")} IS DISTINCT FROM '2000' THEN RAISE 'celá historie nájem 2000: %', v; END IF;
  b := public.get_rent_breakdown(jsonb_build_object('classes', '[{"key":"N","pattern":"nájem"}]'::jsonb, 'document_subtype','issued',
         'mesic', (date_trunc('month', current_date) - interval '1 month')::date::text));
  v := b->'data'->'rows';
  IF ${radek(ICO, "trida_N")} IS DISTINCT FROM '1000' THEN RAISE 'minulý měsíc nájem 1000: %', v; END IF;
  IF ${radek(ICO, "bez_rozpisu")} IS DISTINCT FROM '0' THEN RAISE 'minulý měsíc bez rozpisu 0: %', v; END IF;
`),
    ).not.toThrow();
  });

  it("obdobi_vychozi aktualni_mesic = tento měsíc; mesic ho přebije", () => {
    expect(
      spust(`
  ${kniha(`"obdobi_vychozi":"aktualni_mesic"`)}
  IF ${radek(ICO, "trida_N")} IS DISTINCT FROM '1000' THEN RAISE 'výchozí aktuální měsíc: %', v; END IF;
  b := public.get_rent_breakdown(jsonb_build_object('classes', '[{"key":"N","pattern":"nájem"}]'::jsonb, 'document_subtype','issued',
         'obdobi_vychozi','aktualni_mesic', 'mesic', (date_trunc('month', current_date) - interval '1 month')::date::text));
  v := b->'data'->'rows';
  IF ${radek(ICO, "bez_rozpisu")} IS DISTINCT FROM '0' OR ${radek(ICO, "trida_N")} IS DISTINCT FROM '1000' THEN RAISE 'mesic přebíjí výchozí: %', v; END IF;
`),
    ).not.toThrow();
  });

  it("jen_tridy: jen klienti s částkou v té třídě", () => {
    expect(
      spust(`
  ${kniha(`"obdobi_vychozi":"aktualni_mesic","jen_tridy":["E"]`)}
  IF ${radek(ICO_E, "trida_E")} IS DISTINCT FROM '200' THEN RAISE 'energetický klient chybí: %', v; END IF;
  IF ${radek("Kniha Osoba", "trida_P")} IS NOT NULL THEN RAISE 'klient jen se službou prošel filtrem E: %', v; END IF;
`),
    ).not.toThrow();
  });

  it("provenance.coverage: řádky s IČO z celku (bez IČO = klíčováno jménem)", () => {
    expect(
      spust(`
  ${kniha(`"obdobi_vychozi":"aktualni_mesic"`)}
  IF (b->'provenance'->'coverage'->>'m')::int IS DISTINCT FROM 3 OR (b->'provenance'->'coverage'->>'n')::int IS DISTINCT FROM 2 THEN
    RAISE 'coverage (2 s IČO ze 3): %', b->'provenance'; END IF;
  IF b->'provenance'->'coverage'->>'label_key' IS DISTINCT FROM 'app.prov.coverage.with_ico' THEN RAISE 'label_key: %', b->'provenance'; END IF;
`),
    ).not.toThrow();
  });

  it("vadná konfigurace nebo měsíc = chyba 22023, ne tichá celá historie", () => {
    expect(
      spust(`
  BEGIN
    PERFORM public.get_rent_breakdown('{"obdobi_vychozi":"loni"}'::jsonb);
    RAISE 'neznámé obdobi_vychozi prošlo';
  EXCEPTION WHEN invalid_parameter_value THEN NULL;
  END;
  BEGIN
    PERFORM public.get_rent_breakdown('{"mesic":"září"}'::jsonb);
    RAISE 'neplatný mesic prošel';
  EXCEPTION WHEN invalid_parameter_value THEN NULL;
  END;
`),
    ).not.toThrow();
  });
});

describe.skipIf(!isPgReachable() && !DB_SLIBENA)("dlužníci po splatnosti: jen se vztahem ve třídách (přepínač)", () => {
  const vztah = `
  -- firma A: nájemce T1 — DŘÍVE nájemní položka (zaplaceno), TEĎ dluh na faktuře BEZ položek (úroky / starý export)
  INSERT INTO public.li_source_registry (source_sha256, doc_slug, doc_type, filename, status, fields, line_items) VALUES
   ('vz-1','slug-vz-1','invoice','vz-1.json','AUTO_PASS', jsonb_build_object(
      'counterparty_id', jsonb_build_object('value','93000001'), 'counterparty', jsonb_build_object('value','NÁJEMCE TEST s.r.o.'),
      'document_subtype', jsonb_build_object('value','issued'), 'owner_company', jsonb_build_object('value','Pronajímatel A'),
      'issue_date', jsonb_build_object('value',(current_date-200)::text), 'due_date', jsonb_build_object('value',(current_date-190)::text),
      'amount_unpaid', jsonb_build_object('value','0'), 'storno', jsonb_build_object('value','0')),
      jsonb_build_array(jsonb_build_object('fields', jsonb_build_object('item_name', jsonb_build_object('value','nájem za období 2026/1Q'),'line_total', jsonb_build_object('value','9000'))))),
   ('vz-2','slug-vz-2','invoice','vz-2.json','AUTO_PASS', jsonb_build_object(
      'counterparty_id', jsonb_build_object('value','93000001'), 'counterparty', jsonb_build_object('value','NÁJEMCE TEST s.r.o.'),
      'document_subtype', jsonb_build_object('value','issued'), 'owner_company', jsonb_build_object('value','Pronajímatel A'),
      'issue_date', jsonb_build_object('value',(current_date-60)::text), 'due_date', jsonb_build_object('value',(current_date-50)::text),
      'amount_unpaid', jsonb_build_object('value','1200'), 'storno', jsonb_build_object('value','0')), '[]'::jsonb),
  -- firma K: odběratel kameniva T2 — dluh s položkou prodeje, žádná nájemní nikdy
   ('vz-3','slug-vz-3','invoice','vz-3.json','AUTO_PASS', jsonb_build_object(
      'counterparty_id', jsonb_build_object('value','93000002'), 'counterparty', jsonb_build_object('value','ODBĚRATEL TEST a.s.'),
      'document_subtype', jsonb_build_object('value','issued'), 'owner_company', jsonb_build_object('value','Lom K'),
      'issue_date', jsonb_build_object('value',(current_date-60)::text), 'due_date', jsonb_build_object('value',(current_date-50)::text),
      'amount_unpaid', jsonb_build_object('value','50000'), 'storno', jsonb_build_object('value','0')),
      jsonb_build_array(jsonb_build_object('fields', jsonb_build_object('item_name', jsonb_build_object('value','kamenivo frakce 0-32'),'line_total', jsonb_build_object('value','50000')))));
`;
  const P = `"receivable_from":"issue_date","storno_values":["1","2"],"classes":[{"key":"N","pattern":"nájem|za období"}],"limit":500`;

  it("zapnuto: nájemce zůstane (vztah z dřívější faktury), odběratel kameniva ne; coverage n z m", () => {
    expect(
      spust(`${vztah}
  b := public.get_receivables_overdue('{${P},"jen_tridy_vztahu":true}'::jsonb); v := b->'data'->'rows';
  IF ${radek("93000001", "castka")} IS DISTINCT FROM '1200' THEN RAISE 'nájemce s dluhem bez položek chybí: %', v; END IF;
  IF ${radek("93000002", "castka")} IS NOT NULL THEN RAISE 'odběratel kameniva prošel: %', v; END IF;
  IF (b->'provenance'->'coverage'->>'label_key') IS DISTINCT FROM 'app.prov.coverage.relation_debtors'
     OR (b->'provenance'->'coverage'->>'n')::int >= (b->'provenance'->'coverage'->>'m')::int THEN
    RAISE 'coverage musí přiznat skryté (n < m): %', b->'provenance'; END IF;
`),
    ).not.toThrow();
  });

  it("KONTROLNÍ VZOREK: vypnuto (výchozí) = oba dlužníci, žádné coverage", () => {
    expect(
      spust(`${vztah}
  b := public.get_receivables_overdue('{${P}}'::jsonb); v := b->'data'->'rows';
  IF ${radek("93000001", "castka")} IS DISTINCT FROM '1200' OR ${radek("93000002", "castka")} IS DISTINCT FROM '50000' THEN RAISE 'výchozí musí ukázat oba: %', v; END IF;
  IF b->'provenance' ? 'coverage' THEN RAISE 'coverage bez filtru: %', b->'provenance'; END IF;
`),
    ).not.toThrow();
  });
});
