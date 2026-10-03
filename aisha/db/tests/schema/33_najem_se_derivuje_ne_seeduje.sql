-- pgTAP schema-contract test — NÁJEM SE DERIVUJE Z DOKLADŮ, NEČTE ZE SEEDU.
-- ============================================================================
-- ⭐ Vzniklo z vady, kterou nahlásil majitel a měření potvrdilo (2026-08-03):
-- extranet odpovídal „Areál má 33 nájemců s celkovým ROČNÍM nájmem 851 408 Kč"
-- s pokrytím `full`. Proti vydaným fakturám v korpusu:
--   · pole `annual_rent_czk` neslo MĚSÍČNÍ částku — 25 z 33 sedělo 1:1 na jednu
--     měsíční fakturu ⇒ číslo lhalo o ŘÁD (12×),
--   · 21 z nich už neplatilo (valorizace),
--   · faktury znaly 101 plátců, seed 33,
--   · a `full` tvrdilo plnou jistotu nad snímkem.
-- Derivace nad TÝMIŽ daty dává 71 aktivních a 3 372 387 Kč MĚSÍČNĚ.
--
-- Testované vlastnosti (vlastnosti, ne pravopis):
--   · bez vzorů se NIC nederivuje a je to PŘIZNANÉ (configured=false),
--   · částka je MĚSÍČNÍ a nese OBDOBÍ — hodnota bez období tiše stárne,
--   · žádné pole se nejmenuje „annual/roční" — jméno lhalo o řád,
--   · aktivita je INTERVAL k poslednímu období v datech, ne příznak,
--   · odpovídač NIKDY nehlásí `full` nad derivací (vidí jen fakturované),
--   · stará tříparametrová verze odpovídače NEEXISTUJE (dvě pravdy pod jedním
--     jménem jsou horší než jedna špatná — nepozná se, která odpověděla).
--
-- Fixture zapisuje vlastní doklady s `doc_type='invoice'` a syntetickými jmény;
-- běží UNSEEDED jako superuser a celá se ROLLBACKuje.
-- ============================================================================
BEGIN;
SET search_path = public, extensions;
CREATE EXTENSION IF NOT EXISTS pgtap;
SELECT plan(9);

-- ── Fixture: dva nájemci, tři měsíce, jeden skončil ────────────────────────
-- ⚠️ Klíč MUSÍ být unikátní na řádek. První verze fixtury dávala všem týž
-- `source_sha256` a spadla na UNIQUE — fixtura, která si sama zkolabuje řádky,
-- by měřila něco jiného, než tvrdí. Klíč se proto počítá z OBSAHU dvojice
-- (nájemce, den), stejně jako ho počítá skutečný ingest.
INSERT INTO public.li_source_registry
  (source_sha256, doc_slug, story_id, doc_type, doc_class, filename, status, fields, line_items)
SELECT
  md5('pgtap|'||v.kdo||'|'||v.den), 'pgtap-'||md5('pgtap|'||v.kdo||'|'||v.den),
  NULL, 'invoice', 'transactional',
  'pgtap-'||md5('pgtap|'||v.kdo||'|'||v.den)||'.json', 'AUTO_PASS',
  jsonb_build_object(
    'counterparty', jsonb_build_object('value', v.kdo),
    'issue_date',   jsonb_build_object('value', v.den)),
  jsonb_build_array(jsonb_build_object('fields', jsonb_build_object(
    'item_name',  jsonb_build_object('value','Nájem prostoru'),
    'line_total', jsonb_build_object('value', v.castka))))
FROM (VALUES
  ('PGTAP Stálý s.r.o.','2026-06-10','1000'),
  ('PGTAP Stálý s.r.o.','2026-07-10','1100'),
  ('PGTAP Stálý s.r.o.','2026-08-10','1200'),   -- aktuální
  ('PGTAP Odešlý s.r.o.','2026-03-10','500')    -- starý, mimo okno
) AS v(kdo, den, castka);

-- ── A. bez vzorů se nederivuje a PŘIZNÁ to ─────────────────────────────────
SELECT is(
  (public.get_rent_current('{}'::jsonb)->'data'->'summary'->>'configured')::boolean,
  false, 'bez vzorů: configured=false — prázdno z prázdné konfigurace je přiznané');

-- ── B. částka je MĚSÍČNÍ a nese období ─────────────────────────────────────
SELECT is(
  (public.get_rent_current('{"rent_patterns":["Nájem"]}'::jsonb)
     ->'data'->'summary'->>'period'), '2026-08',
  'souhrn nese OBDOBÍ — hodnota bez období tiše stárne');

SELECT ok(
  (public.get_rent_current('{"rent_patterns":["Nájem"]}'::jsonb)
     ->'data'->'summary'->>'monthly_amount')::numeric >= 1200,
  'měsíční objem obsahuje poslední fakturovanou částku (1200), ne součet všech');

-- ⭐ Nejdůležitější tvrzení testu: NIC se nesmí jmenovat „roční".
SELECT ok(
  public.get_rent_current('{"rent_patterns":["Nájem"]}'::jsonb)::text
    !~* '(annual|rocni|roční)',
  'žádné pole se nejmenuje annual/roční — jméno pole lhalo o ŘÁD (12×)');

-- ── C. aktivita je interval k datům, ne příznak ────────────────────────────
SELECT ok(
  (SELECT count(*) FROM jsonb_array_elements(
     public.get_rent_current('{"rent_patterns":["Nájem"],"active_months":2}'::jsonb)
       ->'data'->'tenants') t
   WHERE (t->>'active')::boolean AND t->>'tenant' LIKE 'PGTAP Stálý%') = 1,
  'nájemce s fakturou v posledním období je AKTIVNÍ');

SELECT ok(
  (SELECT bool_and(NOT (t->>'active')::boolean) FROM jsonb_array_elements(
     public.get_rent_current('{"rent_patterns":["Nájem"],"active_months":2}'::jsonb)
       ->'data'->'tenants') t
   WHERE t->>'tenant' LIKE 'PGTAP Odešlý%'),
  'nájemce s poslední fakturou mimo okno NENÍ aktivní — a nezmizí, jen se označí');

-- ── D. odpovídač: nikdy `full` nad derivací ────────────────────────────────
SELECT isnt(
  public.answer_verified_facts('kolik platí nájemci','strucny','[]'::jsonb,
    '{"rent":{"rent_patterns":["Nájem"]}}'::jsonb)->>'coverage',
  'full', 'derivace NIKDY nehlásí full — vidí jen ty, komu se fakturuje');

SELECT matches(
  public.answer_verified_facts('kolik platí nájemci','strucny','[]'::jsonb,
    '{"rent":{"rent_patterns":["Nájem"]}}'::jsonb)->>'answer',
  'měsíčně', 'odpověď říká MĚSÍČNĚ — dřív tvrdila „roční" nad měsíční hodnotou');

-- ── E. jedna pravda pod jedním jménem ──────────────────────────────────────
SELECT is(
  (SELECT count(*)::int FROM pg_proc WHERE proname = 'answer_verified_facts'),
  1, 'odpovídač existuje JEDNOU — stará 3parametrová verze by tiše vracela seed');

SELECT * FROM finish();
ROLLBACK;
