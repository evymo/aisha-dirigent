-- pgTAP schema-contract tests — platnosti dokladů z JEJICH POLÍ
-- ============================================================================
-- get_doc_expiry_review_block do 2026-09-24 četl vazby twin↔doklad ze zdroje,
-- který v provozu neexistuje (0 vazeb) — bloky sm_expiry a pd_recommend proto
-- nemohly ukázat nic. Přestavba čte datum ze smlouvy samotné.
--
-- Testované vlastnosti:
--   · odmítnutý volající i chybějící konfigurace = platná PRÁZDNÁ tabulka
--     s důvodem v trace_id, ne chyba;
--   · 'upcoming' = jen datum ≥ dnes, nejbližší první; 'expired' = jen datum
--     < dnes, naposledy skončené první, a navíc počet dní po skončení;
--   · nahrazené verze, jiné typy dokladů, doklady bez data a NEPLATNÉ datum
--     z OCR ('2026-02-30') se nezobrazí — a to poslední blok NESHODÍ;
--   · pohled podle firmy (owner_company) filtruje jako registr dokladů;
--   · protistrana je taková, jakou uvádí doklad; chybí-li, '—';
--   · čerstvost = nejnovější created_at v univerzu, ne now() ani ingested_at (ten přepisuje
--     každý import — naměřeno 2026-09-27, brána cerstvost-z-dat; fixture proto sází created_at
--     a ingested_at nechá na now(), takže (13) zároveň dokazuje, že se ingested_at nečte); prázdné
--     univerzum se přizná ':no_data'.
--
-- Fixture používá vlastní doc_type ('pgtap_platnost'), takže se nepotká se
-- skutečnými daty. Runs UNSEEDED as superuser, rolled back.
-- ============================================================================
BEGIN;
SET search_path = public, extensions;
CREATE EXTENSION IF NOT EXISTS pgtap;
SELECT plan(16);

-- ── Identity ─────────────────────────────────────────────────────────────────
SELECT set_config('pl.admin', gen_random_uuid()::text, true);
SELECT set_config('pl.plain', gen_random_uuid()::text, true);  -- authenticated, NE admin

SET session_replication_role = replica;
INSERT INTO aisha_auth.users (id)
  VALUES (current_setting('pl.admin')::uuid), (current_setting('pl.plain')::uuid);
INSERT INTO user_roles (user_id, role)
  VALUES (current_setting('pl.admin')::uuid, 'admin');

-- ── Fixture ──────────────────────────────────────────────────────────────────
--   blizko   končí za 10 dní, Firma A          ← upcoming 1.
--   daleko   končí za 400 dní, bez protistrany ← upcoming 2.
--   nedavno  skončila před 3 dny                ← expired 1.
--   davno    skončila před 100 dny              ← expired 2.
--   nahrazena  končí zítra, ale je nahrazená    ← nikde
--   nesmysl    '2026-02-30' z OCR               ← nikde, a blok nespadne
--   bez_data   datum nemá                       ← nikde
--   cizi_typ   jiný doc_type                    ← nikde
INSERT INTO li_source_registry
  (source_sha256, doc_slug, doc_type, status, fields, line_items, filename, created_at, superseded_by)
VALUES
  (repeat('a', 64), 'pgtap-pl-blizko', 'pgtap_platnost', 'AUTO_PASS',
   jsonb_build_object('valid_to', jsonb_build_object('value', to_char(current_date + 10, 'YYYY-MM-DD')),
                      'counterparty', jsonb_build_object('value', 'Nájemce Blízko s.r.o.'),
                      'owner_company', jsonb_build_object('value', 'Firma A')),
   '[]'::jsonb, 'smlouva-blizko.pdf', '2026-01-02T03:04:05Z', NULL),
  (repeat('b', 64), 'pgtap-pl-daleko', 'pgtap_platnost', 'AUTO_PASS',
   jsonb_build_object('valid_to', jsonb_build_object('value', to_char(current_date + 400, 'YYYY-MM-DD')),
                      'owner_company', jsonb_build_object('value', 'Firma B')),
   '[]'::jsonb, 'smlouva-daleko.pdf', '2025-12-01T00:00:00Z', NULL),
  (repeat('c', 64), 'pgtap-pl-nedavno', 'pgtap_platnost', 'AUTO_PASS',
   jsonb_build_object('valid_to', jsonb_build_object('value', to_char(current_date - 3, 'YYYY-MM-DD'))),
   '[]'::jsonb, 'smlouva-nedavno.pdf', '2025-11-01T00:00:00Z', NULL),
  (repeat('d', 64), 'pgtap-pl-davno', 'pgtap_platnost', 'AUTO_PASS',
   jsonb_build_object('valid_to', jsonb_build_object('value', to_char(current_date - 100, 'YYYY-MM-DD'))),
   '[]'::jsonb, 'smlouva-davno.pdf', '2025-10-01T00:00:00Z', NULL),
  (repeat('e', 64), 'pgtap-pl-nahrazena', 'pgtap_platnost', 'AUTO_PASS',
   jsonb_build_object('valid_to', jsonb_build_object('value', to_char(current_date + 1, 'YYYY-MM-DD'))),
   '[]'::jsonb, 'smlouva-nahrazena.pdf', '2027-01-01T00:00:00Z', 'pgtap-pl-blizko'),
  (repeat('f', 64), 'pgtap-pl-nesmysl', 'pgtap_platnost', 'REVIEW',
   jsonb_build_object('valid_to', jsonb_build_object('value', '2026-02-30')),
   '[]'::jsonb, 'smlouva-nesmysl.pdf', '2027-01-01T00:00:00Z', NULL),
  (repeat('0', 64), 'pgtap-pl-bez-data', 'pgtap_platnost', 'REVIEW',
   '{}'::jsonb, '[]'::jsonb, 'smlouva-bez-data.pdf', '2027-01-01T00:00:00Z', NULL),
  (repeat('1', 64), 'pgtap-pl-cizi-typ', 'pgtap_jiny', 'AUTO_PASS',
   jsonb_build_object('valid_to', jsonb_build_object('value', to_char(current_date + 5, 'YYYY-MM-DD'))),
   '[]'::jsonb, 'jiny.pdf', '2027-01-01T00:00:00Z', NULL);
SET session_replication_role = origin;

-- ── (1)(2) běžný přihlášený uživatel: prázdná platná tabulka ─────────────────
SELECT set_config('request.jwt.claims',
  json_build_object('role', 'authenticated', 'sub', current_setting('pl.plain'))::text, true);
SELECT is(
  get_doc_expiry_review_block('{"doc_type":"pgtap_platnost","date_field":"valid_to"}') #> '{data,rows}',
  '[]'::jsonb, '(1) bez nároku: žádné řádky');
SELECT is(
  get_doc_expiry_review_block('{"doc_type":"pgtap_platnost","date_field":"valid_to"}') #>> '{provenance,trace_id}',
  'doc-expiry:unauthenticated', '(2) bez nároku: důvod v trace_id');

-- ── admin ────────────────────────────────────────────────────────────────────
SELECT set_config('request.jwt.claims',
  json_build_object('role', 'authenticated', 'sub', current_setting('pl.admin'))::text, true);

-- ── (3)(4) chybějící / neplatná konfigurace ─────────────────────────────────
SELECT is(
  get_doc_expiry_review_block('{"date_field":"valid_to","source":"li-contracts"}') #>> '{provenance,trace_id}',
  'doc-expiry:missing_config', '(3) bez doc_type (stará konfigurace) = missing_config, ne chyba');
SELECT is(
  get_doc_expiry_review_block('{"doc_type":"pgtap_platnost","date_field":"valid_to","direction":"bokem"}') #>> '{provenance,trace_id}',
  'doc-expiry:missing_config', '(4) neznámý směr = missing_config, ne tichý výchozí');

-- ── (5)–(9) upcoming ─────────────────────────────────────────────────────────
SELECT lives_ok(
  $$ SELECT get_doc_expiry_review_block('{"doc_type":"pgtap_platnost","date_field":"valid_to"}') $$,
  '(5) neplatné datum z OCR blok neshodí');
SELECT is(
  (SELECT jsonb_agg(r->>'id') FROM jsonb_array_elements(
     get_doc_expiry_review_block('{"doc_type":"pgtap_platnost","date_field":"valid_to"}') #> '{data,rows}') r),
  '["pgtap-pl-blizko","pgtap-pl-daleko"]'::jsonb,
  '(6) upcoming: jen budoucí platné verze, nejbližší první');
SELECT is(
  (SELECT jsonb_agg(c->>'key') FROM jsonb_array_elements(
     get_doc_expiry_review_block('{"doc_type":"pgtap_platnost","date_field":"valid_to"}') #> '{data,columns}') c),
  '["counterparty","filename","owner_company","date"]'::jsonb,
  '(7) upcoming: sloupce jako registr dokladů + datum');
SELECT is(
  get_doc_expiry_review_block('{"doc_type":"pgtap_platnost","date_field":"valid_to"}') #>> '{data,rows,1,counterparty}',
  '—', '(8) protistrana, kterou doklad neuvádí, je „—", ne vymyšlená');
SELECT is(
  get_doc_expiry_review_block('{"doc_type":"pgtap_platnost","date_field":"valid_to"}') #>> '{data,row_kind}',
  'document', '(9) řádek otevírá detail dokladu');

-- ── (10)(11) expired ─────────────────────────────────────────────────────────
SELECT is(
  (SELECT jsonb_agg(jsonb_build_array(r->>'id', (r->>'days')::int)) FROM jsonb_array_elements(
     get_doc_expiry_review_block('{"doc_type":"pgtap_platnost","date_field":"valid_to","direction":"expired"}') #> '{data,rows}') r),
  '[["pgtap-pl-nedavno",3],["pgtap-pl-davno",100]]'::jsonb,
  '(10) expired: naposledy skončené první, se dny po skončení');
SELECT is(
  get_doc_expiry_review_block('{"doc_type":"pgtap_platnost","date_field":"valid_to","direction":"expired"}') #>> '{data,columns,4,key}',
  'days', '(11) expired: sloupec dní po skončení');

-- ── (12) pohled podle firmy ──────────────────────────────────────────────────
SELECT is(
  (SELECT jsonb_agg(r->>'id') FROM jsonb_array_elements(
     get_doc_expiry_review_block('{"doc_type":"pgtap_platnost","date_field":"valid_to","owner_company":"Firma A"}') #> '{data,rows}') r),
  '["pgtap-pl-blizko"]'::jsonb,
  '(12) owner_company filtruje jako přepínač nad registrem');

-- ── (13)–(16) čerstvost z dat ────────────────────────────────────────────────
SELECT is(
  get_doc_expiry_review_block('{"doc_type":"pgtap_platnost","date_field":"valid_to"}') #>> '{provenance,freshness_at}',
  '2026-01-02T03:04:05Z',
  '(13) čerstvost = nejnovější zápis v univerzu (nahrazené, bez data a nesmyslné datum se nepočítají)');
SELECT is(
  get_doc_expiry_review_block('{"doc_type":"pgtap_platnost","date_field":"valid_to"}') #>> '{provenance,trace_id}',
  'doc-expiry:pgtap_platnost:upcoming', '(14) s daty: trace bez :no_data');
SELECT is(
  get_doc_expiry_review_block('{"doc_type":"pgtap_zadny","date_field":"valid_to"}') #>> '{provenance,trace_id}',
  'doc-expiry:pgtap_zadny:upcoming:no_data', '(15) prázdné univerzum se přizná :no_data');
SELECT is(
  get_doc_expiry_review_block('{"doc_type":"pgtap_zadny","date_field":"valid_to"}') #> '{data,rows}',
  '[]'::jsonb, '(16) prázdné univerzum: žádné řádky');

SELECT * FROM finish();
ROLLBACK;
