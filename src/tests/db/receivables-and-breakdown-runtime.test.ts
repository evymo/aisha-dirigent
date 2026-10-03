import { beforeAll, describe, expect, it } from "vitest";
import { psqlMultiline } from "./validation-utils";
import { isPgReachable, reportTestCapabilities } from "./test-env-probe";

/**
 * get_receivables_overdue + get_rent_breakdown — RUNTIME proti čerstvé DB.
 *
 * Pinují tři vlastnosti, na kterých ty bloky stojí a které se dají snadno
 * ztratit refaktorem:
 *
 *  1. PRAVDA O PLATBĚ JE `amount_unpaid`, ne `settled`. Money `PriznakVyrizeno`
 *     je u UHRAZENÉ faktury False — blok postavený na něm tvrdil na produkci
 *     22 762 z 22 916 faktur „neuhrazeno" (1,04 mld Kč) včetně dokladů z 2016.
 *     Případ „settled=false, ale amount_unpaid=0" proto MUSÍ zůstat mimo dlužníky.
 *  2. DLUŽNÍK JE ODBĚRATEL, ne doklad — částky se sčítají přes jeho doklady a
 *     „dní" je nejstarší nezaplacený doklad.
 *  3. NEZAŘAZENÉ SE NEROZPOUŠTÍ. Rozpad drží kbelík '?' viditelně; tiché
 *     přičtení k nájmu by z nejistoty udělalo tvrzení.
 */

const dbAvailable = isPgReachable();
const HEADER = "\\set ON_ERROR_STOP on\n";

/** Doklad do registru: hodnoty polí mají tvar {value}, jak je píše ingest. */
const seed = `
  CREATE OR REPLACE FUNCTION pg_temp.mkdoc(
    p_sha text, p_klient text, p_firma text, p_unpaid text, p_due text,
    p_lines jsonb DEFAULT '[]'::jsonb, p_settled text DEFAULT 'False'
  ) RETURNS void LANGUAGE sql AS $f$
    INSERT INTO public.li_source_registry
      (source_sha256, doc_slug, doc_type, filename, status, fields, line_items)
    VALUES (p_sha, 'slug-'||p_sha, 'invoice', 'doc-'||p_sha||'.json', 'AUTO_PASS',
      jsonb_build_object(
        'counterparty',  jsonb_build_object('value', p_klient),
        'owner_company', jsonb_build_object('value', p_firma),
        'settled',       jsonb_build_object('value', p_settled),
        -- pohledávka = VYDANÁ faktura (invoice_state / get_receivables_overdue)
        'document_subtype', jsonb_build_object('value', 'issued')
      )
      || CASE WHEN p_unpaid IS NULL THEN '{}'::jsonb
              ELSE jsonb_build_object('amount_unpaid', jsonb_build_object('value', p_unpaid)) END
      || CASE WHEN p_due IS NULL THEN '{}'::jsonb
              ELSE jsonb_build_object('due_date', jsonb_build_object('value', p_due)) END,
      p_lines);
  $f$;

  -- ⭐ Řádky dokladu ve tvaru, jaký ingest SKUTEČNĚ zapisuje: každá hodnota nese
  -- provenanci (value/raw/gate/span) pod klíčem "fields" — stejně jako
  -- hodnoty v hlavičce o pár řádků výš.
  --
  -- Dřív si tenhle test tvar VYMÝŠLEL: krmil ploché {"item_name":…,"line_total":…},
  -- což byl přesně tvar, jaký RPC četla. Test i funkce se tedy shodly na něčem,
  -- co v registru nikdy nebylo — brána svítila zeleně, zatímco produkce vracela
  -- u všech nájemců nuly. Naměřeno 2026-07-31: 5 461 položek, zanořených 5 461,
  -- plochých 0. Fixtura, která si vyrobí vlastní univerzum, netestuje nic.
  --
  -- Vstup je {název řádku: částka}, aby zůstalo čitelné, CO se testuje.
  CREATE OR REPLACE FUNCTION pg_temp.mklines(p_items jsonb)
  RETURNS jsonb LANGUAGE sql IMMUTABLE AS $f$
    SELECT coalesce(jsonb_agg(jsonb_build_object('fields', jsonb_build_object(
             'item_name',  jsonb_build_object('value', kv.key,   'raw', kv.key,
                                              'gate', 'PASS', 'span', '{}'::jsonb),
             'line_total', jsonb_build_object('value', kv.value, 'raw', kv.value,
                                              'gate', 'PASS', 'span', '{}'::jsonb)))),
           '[]'::jsonb)
    FROM jsonb_each_text(p_items) kv;
  $f$;
`;

beforeAll(async () => {
  await reportTestCapabilities("get_receivables_overdue + get_rent_breakdown");
});

describe("get_receivables_overdue — kdo kolik dluží k datu", () => {
  it.skipIf(!dbAvailable)("sčítá dluh na odběratele a nepočítá uhrazené", () => {
    const run = () =>
      psqlMultiline(`${HEADER}
BEGIN;
${seed}
DO $$
DECLARE v_rows jsonb; v_a jsonb;
BEGIN
  PERFORM set_config('request.jwt.claims', '{"role":"service_role"}', true);

  -- ALFA: dva doklady po splatnosti (1000 + 500) → 1500, nejstarší 40 dní
  PERFORM pg_temp.mkdoc('r1','ALFA s.r.o.','Firma A','1000',(current_date - 40)::text);
  PERFORM pg_temp.mkdoc('r2','ALFA s.r.o.','Firma A','500', (current_date - 10)::text);
  -- BETA: UHRAZENO (amount_unpaid = 0), ale settled=False → NESMÍ být dlužník
  PERFORM pg_temp.mkdoc('r3','BETA s.r.o.','Firma A','0',   (current_date - 90)::text);
  -- GAMA: dluh, ale splatnost v BUDOUCNU → ještě není po splatnosti
  PERFORM pg_temp.mkdoc('r4','GAMA s.r.o.','Firma A','700', (current_date + 5)::text);
  -- DELTA: starý korpus BEZ stavu úhrady → mlčet, ne hádat
  PERFORM pg_temp.mkdoc('r5','DELTA s.r.o.','Firma A',NULL, (current_date - 200)::text);

  v_rows := public.get_receivables_overdue('{}'::jsonb) -> 'data' -> 'rows';

  IF jsonb_array_length(v_rows) <> 1 THEN
    RAISE 'čekán 1 dlužník (ALFA), je %: %', jsonb_array_length(v_rows), v_rows;
  END IF;
  SELECT r INTO v_a FROM jsonb_array_elements(v_rows) r WHERE r->>'klient' = 'ALFA s.r.o.';
  IF v_a IS NULL THEN RAISE 'ALFA chybí: %', v_rows; END IF;
  IF (v_a->>'castka')::numeric <> 1500 THEN RAISE 'částka není součet přes doklady: %', v_a; END IF;
  IF (v_a->>'dni')::int <> 40 THEN RAISE 'dní není nejstarší doklad: %', v_a; END IF;
  IF (v_a->>'dokladu')::int <> 2 THEN RAISE 'počet dokladů: %', v_a; END IF;
END $$;
ROLLBACK;
`);
    expect(run).not.toThrow();
  });

  it.skipIf(!dbAvailable)("filtruje podle firmy (osa pohledu) a podle min_days", () => {
    const run = () =>
      psqlMultiline(`${HEADER}
BEGIN;
${seed}
DO $$
DECLARE v jsonb;
BEGIN
  PERFORM set_config('request.jwt.claims', '{"role":"service_role"}', true);
  PERFORM pg_temp.mkdoc('s1','ALFA s.r.o.','Firma A','1000',(current_date - 40)::text);
  PERFORM pg_temp.mkdoc('s2','OMEGA s.r.o.','Firma B','2000',(current_date - 5)::text);

  v := public.get_receivables_overdue('{"owner_company":"Firma B"}'::jsonb)->'data'->'rows';
  IF jsonb_array_length(v) <> 1 OR v->0->>'klient' <> 'OMEGA s.r.o.' THEN
    RAISE 'pohled podle firmy neomezil: %', v;
  END IF;

  -- min_days odřízne čerstvé dluhy
  v := public.get_receivables_overdue('{"min_days":30}'::jsonb)->'data'->'rows';
  IF jsonb_array_length(v) <> 1 OR v->0->>'klient' <> 'ALFA s.r.o.' THEN
    RAISE 'min_days nefiltruje: %', v;
  END IF;
END $$;
ROLLBACK;
`);
    expect(run).not.toThrow();
  });
});

describe("get_rent_breakdown — nájem / energie / služby za nájemce", () => {
  it.skipIf(!dbAvailable)("sčítá řádky napříč fakturami a nezařazené drží zvlášť", () => {
    const run = () =>
      psqlMultiline(`${HEADER}
BEGIN;
${seed}
DO $$
DECLARE v jsonb; v_r jsonb;
  v_cls jsonb := '{"classes":[
    {"key":"E","label_key":"app.cols.energy",  "pattern":"energi|plyn|vod[ay]|spotřeb"},
    {"key":"N","label_key":"app.cols.rent",    "pattern":"nájem|pronájem|nebytov"},
    {"key":"P","label_key":"app.cols.services","pattern":"služb|úklid"}]}'::jsonb;
BEGIN
  PERFORM set_config('request.jwt.claims', '{"role":"service_role"}', true);

  -- faktura za nájem + úklid
  PERFORM pg_temp.mkdoc('b1','ALFA s.r.o.','Firma A','0',(current_date)::text,
    pg_temp.mklines('{"Pronájem nebytových prostor":"10000","úklid společných prostor":"1000"}'::jsonb));
  -- SAMOSTATNÁ přefakturace energií — proto se nesmí číst z hlavičky
  PERFORM pg_temp.mkdoc('b2','ALFA s.r.o.','Firma A','0',(current_date)::text,
    pg_temp.mklines('{"spotřeba plynu za rok 2025":"5000"}'::jsonb));
  -- řádek, který žádný vzor nechytí → kbelík '?', ne tiché přičtení k nájmu
  PERFORM pg_temp.mkdoc('b3','ALFA s.r.o.','Firma A','0',(current_date)::text,
    pg_temp.mklines('{"Kauce":"3000"}'::jsonb));

  v := public.get_rent_breakdown(v_cls)->'data'->'rows';
  SELECT r INTO v_r FROM jsonb_array_elements(v) r WHERE r->>'klient' = 'ALFA s.r.o.';
  IF v_r IS NULL THEN RAISE 'ALFA chybí: %', v; END IF;
  IF (v_r->>'trida_N')::numeric <> 10000 THEN RAISE 'nájem: %', v_r; END IF;
  IF (v_r->>'trida_E')::numeric <> 5000  THEN RAISE 'energie napříč fakturami: %', v_r; END IF;
  IF (v_r->>'trida_P')::numeric <> 1000  THEN RAISE 'služby: %', v_r; END IF;
  IF (v_r->>'ostatni')::numeric <> 3000  THEN RAISE 'nezařazené se rozpustily: %', v_r; END IF;
  IF (v_r->>'celkem')::numeric  <> 19000 THEN RAISE 'celkem: %', v_r; END IF;
END $$;
ROLLBACK;
`);
    expect(run).not.toThrow();
  });

  it.skipIf(!dbAvailable)("bez katalogu vzorů nic nedomýšlí — vše je nezařazené", () => {
    const run = () =>
      psqlMultiline(`${HEADER}
BEGIN;
${seed}
DO $$
DECLARE v_r jsonb;
BEGIN
  PERFORM set_config('request.jwt.claims', '{"role":"service_role"}', true);
  PERFORM pg_temp.mkdoc('c1','ALFA s.r.o.','Firma A','0',(current_date)::text,
    pg_temp.mklines('{"Pronájem nebytových prostor":"10000"}'::jsonb));

  SELECT r INTO v_r FROM jsonb_array_elements(
    public.get_rent_breakdown('{}'::jsonb)->'data'->'rows') r;
  -- bez katalogu nejsou žádné sloupce tříd (trida_*) — nic se nezařadí
  IF EXISTS (SELECT 1 FROM jsonb_object_keys(v_r) k WHERE left(k, 6) = 'trida_') OR (v_r->>'ostatni')::numeric <> 10000 THEN
    RAISE 'prázdný katalog něco zařadil: %', v_r;
  END IF;
END $$;
ROLLBACK;
`);
    expect(run).not.toThrow();
  });
});
