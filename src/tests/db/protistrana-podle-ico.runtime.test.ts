/**
 * Přehledy protistran klíčuje IČO, ne jméno z faktury (RUNTIME, throwaway DB).
 *
 * ⛔ NAMĚŘENO 2026-09-29 na riq (podnět idata #114, majitel „jména k IČO se mění
 * v čase, fúze…“): `get_receivables_overdue` a `get_rent_breakdown` seskupovaly
 * `group by klient` (jméno z faktury). „Slezské kamenolomy a.s." přešlo 1. 10. 2019
 * z IČO 29243661 (dnes Business Park Ďáblická) na 08300283 → jeden řádek
 * 142 268 Kč místo 117 975 + 24 293. A naopak přejmenovaná firma (14 IČO s víc
 * jmény) se rozpadla na víc dlužníků.
 *
 * Měří se chování:
 *   - dvě IČO se stejným jménem = DVA řádky (kontrolní vzorek: součet sedí);
 *   - jedno IČO se dvěma jmény v čase = JEDEN řádek pod jménem z nejnovějšího dokladu;
 *   - schválený název (company_name potvrzený člověkem, platný teď) má přednost;
 *     schválení, které už NEPLATÍ (valid_to v minulosti), ne;
 *   - bez IČO (fyzická osoba) se seskupuje jménem;
 *   - dlužník dvou našich firem má v řádku OBĚ;
 *   - rozpad nájmů: tatáž pravidla, `id` = IČO.
 *
 * Spouští se přes: npm run test:db:pohledavka (throwaway DB z baseline + heals + seed)
 */
import { describe, expect, it } from "vitest";
import { psqlMultiline } from "./validation-utils";
import { isPgReachable } from "./test-env-probe";

const DB_SLIBENA = Boolean(process.env.AISHA_DB_URL);
const HEADER = "\\set ON_ERROR_STOP on\n";
const P = `"receivable_from":"issue_date","storno_values":["1","2"]`;

const STEJNE_JMENO = "SLOUČENÉ JMÉNO TEST a.s.";
const ICO_A = "91000001"; // staré nositel jména (dnes jinak)
const ICO_B = "91000002"; // dnešní nositel jména
const ICO_PREJM = "91000003"; // přejmenovaná firma
const ICO_SCHV = "91000004"; // firma se schváleným názvem
const ICO_DVE = "91000005"; // dluží dvěma našim firmám

const seed = `
  CREATE OR REPLACE FUNCTION pg_temp.fa(
    p_sha text, p_ico text, p_jmeno text, p_vystaveno int, p_splatnost int, p_zbyva text,
    p_firma text DEFAULT 'Naše firma A', p_polozka text DEFAULT NULL
  ) RETURNS void LANGUAGE sql AS $f$
    INSERT INTO public.li_source_registry
      (source_sha256, doc_slug, doc_type, filename, status, fields, line_items)
    VALUES (p_sha, 'slug-'||p_sha, 'invoice', 'fa-'||p_sha||'.json', 'AUTO_PASS',
      jsonb_strip_nulls(jsonb_build_object(
        'counterparty_id',  CASE WHEN p_ico IS NULL THEN NULL ELSE jsonb_build_object('value', p_ico) END,
        'counterparty',     jsonb_build_object('value', p_jmeno),
        'document_subtype', jsonb_build_object('value', 'issued'),
        'owner_company',    jsonb_build_object('value', p_firma),
        'issue_date',       jsonb_build_object('value', (current_date + p_vystaveno)::text),
        'due_date',         jsonb_build_object('value', (current_date + p_splatnost)::text),
        'total_amount',     jsonb_build_object('value', p_zbyva),
        'amount_unpaid',    jsonb_build_object('value', p_zbyva),
        'storno',           jsonb_build_object('value', '0'))),
      CASE WHEN p_polozka IS NULL THEN '[]'::jsonb ELSE jsonb_build_array(jsonb_build_object('fields', jsonb_build_object(
        'item_name',  jsonb_build_object('value', p_polozka),
        'line_total', jsonb_build_object('value', p_zbyva)))) END);
  $f$;

  -- Slité jméno: 29243661-like (stará faktura na staré jméno) + 08300283-like (dnes)
  PERFORM pg_temp.fa('pi-a1', '${ICO_A}', '${STEJNE_JMENO}', -2800, -2790, '117975', 'Naše firma A', 'nájem prostor');
  PERFORM pg_temp.fa('pi-a2', '${ICO_A}', 'DNEŠNÍ JMÉNO A TEST a.s.', -1000, -990, '0');   -- novější doklad, jiné jméno
  PERFORM pg_temp.fa('pi-b1', '${ICO_B}', '${STEJNE_JMENO}', -300, -290, '24293', 'Naše firma A', 'nájem prostor');
  -- Přejmenování: dluh visí na starém jménu, novější (uhrazený) doklad nese nové
  PERFORM pg_temp.fa('pi-p1', '${ICO_PREJM}', 'STARÉ JMÉNO TEST s.r.o.', -200, -190, '5000');
  PERFORM pg_temp.fa('pi-p2', '${ICO_PREJM}', 'NOVÉ JMÉNO TEST s.r.o.', -100, -90, '700');
  -- Schválený název vyhrává nad jménem z dokladu
  PERFORM pg_temp.fa('pi-s1', '${ICO_SCHV}', 'JMÉNO Z FAKTURY TEST s.r.o.', -50, -40, '1000');
  -- Fyzická osoba bez IČO: dvě faktury = jeden dlužník (jménem)
  PERFORM pg_temp.fa('pi-o1', NULL, 'Jan Testovací', -60, -50, '300');
  PERFORM pg_temp.fa('pi-o2', NULL, 'Jan Testovací', -30, -20, '200');
  -- Dluh dvěma našim firmám
  PERFORM pg_temp.fa('pi-d1', '${ICO_DVE}', 'DVĚ FIRMY TEST s.r.o.', -80, -70, '400', 'Naše firma A');
  PERFORM pg_temp.fa('pi-d2', '${ICO_DVE}', 'DVĚ FIRMY TEST s.r.o.', -80, -70, '600', 'Naše firma B');
`;

const twinSchvaleny = `
  INSERT INTO public.twin_entities (entity_type, label) VALUES ('company', 'twin label TEST') RETURNING id INTO v_t;
  INSERT INTO public.twin_external_refs (twin_id, source, source_key, ref_kind, state, proposed_by, confirmed_at)
  VALUES (v_t, 'test', '${ICO_SCHV}', 'company_ico', 'confirmed', 'test', now());
  -- schválení, které už NEPLATÍ — nesmí vyhrát
  INSERT INTO public.twin_external_refs (twin_id, source, source_key, ref_kind, state, proposed_by, confirmed_at, valid_from, valid_to)
  VALUES (v_t, 'test', 'PROŠLÉ JMÉNO TEST s.r.o.', 'company_name', 'confirmed', 'test', now() - interval '2 years', now() - interval '3 years', now() - interval '1 year');
  INSERT INTO public.twin_external_refs (twin_id, source, source_key, ref_kind, state, proposed_by, confirmed_at, valid_from)
  VALUES (v_t, 'test', 'SCHVÁLENÉ JMÉNO TEST s.r.o.', 'company_name', 'confirmed', 'test', now(), now() - interval '1 year');
`;

function spust(telo: string): () => string {
  return () =>
    psqlMultiline(`${HEADER}
BEGIN;
DO $$
DECLARE v jsonb; v_t uuid; n numeric; t text;
BEGIN
  PERFORM set_config('request.jwt.claims', '{"role":"service_role"}', true);
${seed}
${twinSchvaleny}
${telo}
END $$;
ROLLBACK;
`);
}

const radek = (id: string, pole: string) =>
  `(SELECT r->>'${pole}' FROM jsonb_array_elements(v) r WHERE r->>'id' = '${id}')`;

describe.skipIf(!isPgReachable() && !DB_SLIBENA)("přehledy protistran: identita podle IČO, jméno aktuální", () => {
  it("dlužníci: dvě IČO pod jedním jménem = dva řádky; KONTROLNÍ VZOREK součet sedí", () => {
    expect(
      spust(`
  v := public.get_receivables_overdue('{${P},"limit":500}'::jsonb)->'data'->'rows';
  IF ${radek(ICO_A, "castka")} IS DISTINCT FROM '117975' THEN RAISE 'IČO A: čekáno 117975, je %', ${radek(ICO_A, "castka")}; END IF;
  IF ${radek(ICO_B, "castka")} IS DISTINCT FROM '24293'  THEN RAISE 'IČO B: čekáno 24293, je %', ${radek(ICO_B, "castka")}; END IF;
  -- jméno je AKTUÁLNÍ: IČO A má novější doklad s jiným jménem → ne slité jméno
  IF ${radek(ICO_A, "klient")} IS DISTINCT FROM 'DNEŠNÍ JMÉNO A TEST a.s.' THEN RAISE 'IČO A jméno: %', ${radek(ICO_A, "klient")}; END IF;
  IF ${radek(ICO_B, "klient")} IS DISTINCT FROM '${STEJNE_JMENO}' THEN RAISE 'IČO B jméno: %', ${radek(ICO_B, "klient")}; END IF;
  IF EXISTS (SELECT 1 FROM jsonb_array_elements(v) r WHERE r->>'castka' = '142268') THEN RAISE 'slitý řádek 142268 přežil: %', v; END IF;
`),
    ).not.toThrow();
  });

  it("dlužníci: přejmenovaná firma = JEDEN řádek pod jménem z nejnovějšího dokladu", () => {
    expect(
      spust(`
  v := public.get_receivables_overdue('{${P},"limit":500}'::jsonb)->'data'->'rows';
  IF ${radek(ICO_PREJM, "castka")} IS DISTINCT FROM '5700' THEN RAISE 'přejmenovaná: čekáno 5700 v jednom řádku, je %', ${radek(ICO_PREJM, "castka")}; END IF;
  IF ${radek(ICO_PREJM, "klient")} IS DISTINCT FROM 'NOVÉ JMÉNO TEST s.r.o.' THEN RAISE 'jméno: %', ${radek(ICO_PREJM, "klient")}; END IF;
  IF (SELECT count(*) FROM jsonb_array_elements(v) r WHERE r->>'klient' LIKE '%JMÉNO TEST s.r.o.' AND r->>'id' <> '${ICO_SCHV}') <> 1 THEN
    RAISE 'přejmenovaná firma se rozpadla: %', v; END IF;
`),
    ).not.toThrow();
  });

  it("dlužníci: schválený název platný teď vyhrává; prošlé schválení ne", () => {
    expect(
      spust(`
  v := public.get_receivables_overdue('{${P},"limit":500}'::jsonb)->'data'->'rows';
  IF ${radek(ICO_SCHV, "klient")} IS DISTINCT FROM 'SCHVÁLENÉ JMÉNO TEST s.r.o.' THEN RAISE 'schválený název: %', ${radek(ICO_SCHV, "klient")}; END IF;
`),
    ).not.toThrow();
  });

  it("dlužníci: bez IČO jménem; dlužník dvou našich firem nese obě", () => {
    expect(
      spust(`
  v := public.get_receivables_overdue('{${P},"limit":500}'::jsonb)->'data'->'rows';
  IF ${radek("Jan Testovací", "castka")} IS DISTINCT FROM '500' THEN RAISE 'osoba bez IČO: čekáno 500 v jednom řádku, je %', ${radek("Jan Testovací", "castka")}; END IF;
  IF ${radek(ICO_DVE, "firma")} IS DISTINCT FROM 'Naše firma A · Naše firma B' THEN RAISE 'firmy: %', ${radek(ICO_DVE, "firma")}; END IF;
  IF ${radek(ICO_DVE, "castka")} IS DISTINCT FROM '1000' THEN RAISE 'dvě firmy součet: %', ${radek(ICO_DVE, "castka")}; END IF;
`),
    ).not.toThrow();
  });

  it("rozpad nájmů: IČO jako identita a id, jméno aktuální", () => {
    expect(
      spust(`
  v := public.get_rent_breakdown('{"classes":[{"key":"N","pattern":"nájem"}],"limit":500}'::jsonb)->'data'->'rows';
  IF ${radek(ICO_A, "trida_N")} IS DISTINCT FROM '117975' THEN RAISE 'rozpad IČO A: %', v; END IF;
  IF ${radek(ICO_B, "trida_N")} IS DISTINCT FROM '24293'  THEN RAISE 'rozpad IČO B: %', v; END IF;
  IF ${radek(ICO_A, "klient")} IS DISTINCT FROM 'DNEŠNÍ JMÉNO A TEST a.s.' THEN RAISE 'rozpad jméno A: %', ${radek(ICO_A, "klient")}; END IF;
  IF EXISTS (SELECT 1 FROM jsonb_array_elements(v) r WHERE r->>'id' = '${STEJNE_JMENO}') THEN RAISE 'rozpad klíčuje jménem: %', v; END IF;
`),
    ).not.toThrow();
  });
});
