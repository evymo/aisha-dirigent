-- pgTAP schema-contract tests — jeden řádek na jeden skutečný doklad
-- ============================================================================
-- Dvě úklidové RPC, které smějí MAZAT produkční evidenci. Proto se tu netestuje
-- „vrátí to nějaké číslo", ale vlastnosti, na kterých stojí důvěra v to mazání:
--
--   li_dedupe_source_registry(p_identity_fields, p_dry_run)
--     — p_dry_run=true nesmí sáhnout na nic;
--     — po ostrém běhu zbyde právě JEDEN řádek na identitu;
--     — přežít musí NEJNOVĚJŠÍ generace (ne libovolná);
--     — doklad, pro jehož typ identita deklarovaná NENÍ, se nesmí ztratit —
--       a musí být VIDĚT v undeclared_doc_types (mlčení o nepokrytém typu se
--       nesmí dát splést s „tam nic nebylo");
--     — odvozené řádky (li_obligations, li_links) odejdou s obětí, ale ne
--       s vítězem.
--
--   li_dedupe_knowledge_items(p_categories, p_dry_run)
--     — táž pravidla nad KB vrstvou; navíc se NESMÍ smazat záznam, na kterém
--       visí lidská práce (knowledge_attribution / agent_knowledge_bindings).
--
-- Fixture úmyslně používá vlastní doc_type/kategorii ('pgtap_note'), takže
-- suite nikdy nesáhne na skutečná data ani při běhu proti obydlené databázi.
--
-- Runs UNSEEDED as superuser (FK/triggery vypnuty jen pro fixture; guardy se
-- zkoušejí přes request.jwt.claims). Rolled back.
-- ============================================================================
BEGIN;
SET search_path = public, extensions;
CREATE EXTENSION IF NOT EXISTS pgtap;
SELECT plan(26);

-- ── Identity ─────────────────────────────────────────────────────────────────
SELECT set_config('dd.admin', gen_random_uuid()::text, true);
SELECT set_config('dd.plain', gen_random_uuid()::text, true);  -- authenticated, NE admin
SELECT set_config('dd.story', gen_random_uuid()::text, true);

SET session_replication_role = replica;
INSERT INTO aisha_auth.users (id)
  VALUES (current_setting('dd.admin')::uuid), (current_setting('dd.plain')::uuid);
INSERT INTO user_roles (user_id, role)
  VALUES (current_setting('dd.admin')::uuid, 'admin');
INSERT INTO partner_stories (id, title)
  VALUES (current_setting('dd.story')::uuid, 'pgtap dedupe story');
SET session_replication_role = origin;

-- ── Fixture: registr ─────────────────────────────────────────────────────────
-- DOK-1 má dvě generace (starší chudší, novější bohatší), DOK-2 jednu.
-- 'pgtap_other' je typ BEZ deklarované identity, 'pgtap_note' bez čísla dokladu
-- je řádek, kterému deklarované pole chybí. Obojí musí přežít a být vidět.
INSERT INTO li_source_registry
  (source_sha256, doc_slug, doc_type, status, fields, line_items, filename, ingested_at)
VALUES
  (repeat('1', 64), 'pgtap-doc-stara', 'pgtap_note', 'REVIEW',
   jsonb_build_object('note_number', jsonb_build_object('value', 'DOK-1')),
   '[]'::jsonb, 'dok-1.json', now() - interval '2 hours'),
  (repeat('2', 64), 'pgtap-doc-nova', 'pgtap_note', 'AUTO_PASS',
   jsonb_build_object('note_number', jsonb_build_object('value', 'DOK-1'),
                      'driver_name', jsonb_build_object('value', 'Novák')),
   '[]'::jsonb, 'dok-1.json', now() - interval '1 hour'),
  (repeat('3', 64), 'pgtap-doc-jedinacek', 'pgtap_note', 'AUTO_PASS',
   jsonb_build_object('note_number', jsonb_build_object('value', 'DOK-2')),
   '[]'::jsonb, 'dok-2.json', now()),
  (repeat('4', 64), 'pgtap-doc-bez-cisla', 'pgtap_note', 'REVIEW',
   jsonb_build_object('counterparty', jsonb_build_object('value', 'Bez čísla')),
   '[]'::jsonb, 'dok-3.json', now()),
  (repeat('5', 64), 'pgtap-doc-jiny-typ', 'pgtap_other', 'AUTO_PASS',
   jsonb_build_object('note_number', jsonb_build_object('value', 'DOK-1')),
   '[]'::jsonb, 'jiny.json', now());

-- Vadný běh: doklad má PRÁZDNÁ pole, takže vytěženým klíčem ho spárovat nejde —
-- ale jméno zdrojového souboru má. Přesně stav 22 000 faktur v produkci.
INSERT INTO li_source_registry
  (source_sha256, doc_slug, doc_type, status, fields, line_items, filename, ingested_at)
VALUES
  (repeat('6', 64), 'pgtap-skorapka', 'pgtap_shell', 'REVIEW', '{}'::jsonb, '[]'::jsonb,
   'faktura-77.json', now() - interval '3 hours'),
  (repeat('7', 64), 'pgtap-premapovana', 'pgtap_shell', 'AUTO_PASS',
   jsonb_build_object('invoice_number', jsonb_build_object('value', 'F-77')),
   '[]'::jsonb, 'faktura-77.json', now());

-- Závazek na oběti (sha 1…) i na vítězi (sha 2…) a vazba mezi obětí a jinatkem.
INSERT INTO li_obligations (obligation_key, source_sha256, doc_slug, rule_key, quote)
VALUES ('pgtap-ob-obet', repeat('1', 64), 'pgtap-doc-stara', 'pgtap', 'citace oběti'),
       ('pgtap-ob-vitez', repeat('2', 64), 'pgtap-doc-nova', 'pgtap', 'citace vítěze');
INSERT INTO li_links (link_key, rule_key, relation, from_sha256, to_sha256)
VALUES ('pgtap-link', 'pgtap', 'relates_to', repeat('1', 64), repeat('3', 64));

SELECT set_config('dd.ident', '{"pgtap_note":"note_number"}', true);

-- ── (1)(2) obě funkce vůbec existují ─────────────────────────────────────────
SELECT has_function('public', 'li_dedupe_source_registry',
  ARRAY['jsonb', 'boolean'], '(1) li_dedupe_source_registry existuje');
SELECT has_function('public', 'li_dedupe_knowledge_items',
  ARRAY['text[]', 'boolean'], '(2) li_dedupe_knowledge_items existuje');

-- ── (3)(4) neoprávněný volající neuklízí ─────────────────────────────────────
SELECT set_config('request.jwt.claims',
  json_build_object('role', 'authenticated', 'sub', current_setting('dd.plain'))::text, true);
SELECT throws_ok(
  $$ SELECT li_dedupe_source_registry('{"pgtap_note":"note_number"}'::jsonb, true) $$,
  '42501', NULL, '(3) registr: běžný přihlášený uživatel je odmítnut');
SELECT throws_ok(
  $$ SELECT li_dedupe_knowledge_items(ARRAY['pgtap_note'], true) $$,
  '42501', NULL, '(4) KB: běžný přihlášený uživatel je odmítnut');

-- ── admin dál ────────────────────────────────────────────────────────────────
SELECT set_config('request.jwt.claims',
  json_build_object('role', 'authenticated', 'sub', current_setting('dd.admin'))::text, true);

-- ── (5)–(8) dry-run: spočítá, ale nesáhne ────────────────────────────────────
SELECT is(
  (li_dedupe_source_registry(current_setting('dd.ident')::jsonb, true) ->> 'duplicate_rows'),
  '1', '(5) dry-run najde jednu nadbytečnou generaci');
SELECT is(
  (SELECT count(*) FROM li_source_registry WHERE doc_slug LIKE 'pgtap-doc-%'),
  5::bigint, '(6) dry-run nesmazal ani řádek');
SELECT is(
  (li_dedupe_source_registry(current_setting('dd.ident')::jsonb, true)
     -> 'undeclared_doc_types' ->> 'pgtap_other'),
  '1', '(7) typ bez deklarované identity je VIDĚT jako mezera, ne ticho');
SELECT is(
  (li_dedupe_source_registry(current_setting('dd.ident')::jsonb, true)
     -> 'no_identity_value' ->> 'pgtap_note'),
  '1', '(8) doklad bez čísla je VIDĚT jako mezera');

-- ── ostrý běh ────────────────────────────────────────────────────────────────
SELECT lives_ok(
  $$ SELECT li_dedupe_source_registry(current_setting('dd.ident')::jsonb, false) $$,
  '(9) ostrý běh proběhne');

-- ── (10)–(15) vlastnosti výsledku ────────────────────────────────────────────
SELECT is(
  (SELECT count(*) FROM li_source_registry
    WHERE doc_type = 'pgtap_note' AND fields -> 'note_number' ->> 'value' = 'DOK-1'),
  1::bigint, '(10) na jednu identitu zbyl právě jeden řádek');
SELECT is(
  (SELECT doc_slug FROM li_source_registry
    WHERE doc_type = 'pgtap_note' AND fields -> 'note_number' ->> 'value' = 'DOK-1'),
  'pgtap-doc-nova', '(11) přežila NEJNOVĚJŠÍ generace, ne libovolná');
SELECT is(
  (SELECT count(*) FROM li_source_registry WHERE doc_slug = 'pgtap-doc-bez-cisla'),
  1::bigint, '(12) doklad bez identifikujícího pole se neztratil');
SELECT is(
  (SELECT count(*) FROM li_source_registry WHERE doc_slug = 'pgtap-doc-jiny-typ'),
  1::bigint, '(13) doklad typu bez deklarované identity se neztratil');
SELECT is(
  (SELECT count(*) FROM li_obligations WHERE obligation_key = 'pgtap-ob-obet'),
  0::bigint, '(14) závazek zmizel s obětí (žádný sirotek na mrtvý doklad)');
SELECT is(
  (SELECT count(*) FROM li_obligations WHERE obligation_key = 'pgtap-ob-vitez'),
  1::bigint, '(15) závazek vítěze zůstal');

-- ── (16)(17) vazba a audit ───────────────────────────────────────────────────
SELECT is(
  (SELECT count(*) FROM li_links WHERE link_key = 'pgtap-link'),
  0::bigint, '(16) vazba na smazaný konec zmizela');
SELECT isnt_empty(
  $$ SELECT 1 FROM audit_journal WHERE action = 'li_source_registry.dedupe_completed' $$,
  '(17) mazání je zapsané v audit_journal');

-- ── (17a)–(17c) identita jménem souboru: jediná cesta k dokladu s prázdnými poli
SELECT throws_ok(
  $$ SELECT li_dedupe_source_registry('{"pgtap_shell":"@nesmysl"}'::jsonb, true) $$,
  NULL, NULL, '(17a) neznámá sloupcová identita je chyba, ne tiché přeskočení');
SELECT is(
  (li_dedupe_source_registry('{"pgtap_shell":"@filename"}'::jsonb, false) ->> 'duplicate_rows'),
  '1', '(17b) skořápka a její přemapovaná generace se spárují jménem souboru');
SELECT is(
  (SELECT doc_slug FROM li_source_registry WHERE doc_type = 'pgtap_shell'),
  'pgtap-premapovana', '(17c) přežil doklad S POLI, ne prázdná skořápka');

-- ── Fixture: KB vrstva ───────────────────────────────────────────────────────
SELECT set_config('dd.ki_stary', gen_random_uuid()::text, true);
SELECT set_config('dd.ki_novy',  gen_random_uuid()::text, true);
SELECT set_config('dd.ki_chran', gen_random_uuid()::text, true);
SELECT set_config('dd.ki_chran_novy', gen_random_uuid()::text, true);

-- ⛔ NAMĚŘENO 2026-09-13: seed (core/02_languages.sql) nese tytéž kódy s jinými
-- hodnotami (cs/en is_default, name_native). DO NOTHING by nad DB se seedem nechal
-- SEEDOVÝ řádek a test by běžel nad jinými daty než v CI (bez seedu). DO UPDATE =
-- fixture vyhrává v obou. Brána: pgtap-fixture-nekoliduje-se-seedem.gate.test.ts.
INSERT INTO supported_languages (code, name_native, name_key, is_active, is_default, sort_order)
  VALUES ('cs', 'Cestina', 'languages.cs.name', true, false, 1)
  ON CONFLICT (code) DO UPDATE SET
    name_native = EXCLUDED.name_native, name_key = EXCLUDED.name_key,
    is_active = EXCLUDED.is_active, is_default = EXCLUDED.is_default, sort_order = EXCLUDED.sort_order;

INSERT INTO knowledge_items
  (id, story_id, item_type, source_type, title, body_markdown, category,
   status, visibility, version, locale, created_at)
VALUES
  (current_setting('dd.ki_stary')::uuid, current_setting('dd.story')::uuid,
   'engineering_doc', 'manual', 'dodak-DOK-1', 'stará verze', 'pgtap_note',
   'active', 'private', 1, 'cs', now() - interval '2 hours'),
  (current_setting('dd.ki_novy')::uuid, current_setting('dd.story')::uuid,
   'engineering_doc', 'manual', 'dodak-DOK-1', 'nová verze', 'pgtap_note',
   'active', 'private', 1, 'cs', now()),
  (current_setting('dd.ki_chran')::uuid, current_setting('dd.story')::uuid,
   'engineering_doc', 'manual', 'dodak-DOK-9', 'kurátorovaná', 'pgtap_note',
   'active', 'private', 1, 'cs', now() - interval '2 hours'),
  (current_setting('dd.ki_chran_novy')::uuid, current_setting('dd.story')::uuid,
   'engineering_doc', 'manual', 'dodak-DOK-9', 'novější', 'pgtap_note',
   'active', 'private', 1, 'cs', now());

INSERT INTO knowledge_chunks (knowledge_item_id, chunk_index, chunk_text, locale)
VALUES (current_setting('dd.ki_stary')::uuid, 0, 'chunk staré verze', 'cs'),
       (current_setting('dd.ki_novy')::uuid,  0, 'chunk nové verze', 'cs');

-- na starší z dvojice DOK-9 visí lidská práce → nesmí padnout
INSERT INTO knowledge_attribution (knowledge_item_id, story_id)
VALUES (current_setting('dd.ki_chran')::uuid, current_setting('dd.story')::uuid);

-- ── (18)(19) KB dry-run ──────────────────────────────────────────────────────
SELECT is(
  (li_dedupe_knowledge_items(ARRAY['pgtap_note'], true) ->> 'duplicate_items'),
  '1', '(18) dry-run najde jeden nadbytečný KB záznam (druhý je chráněný)');
SELECT is(
  (SELECT count(*) FROM knowledge_items WHERE category = 'pgtap_note'),
  4::bigint, '(19) dry-run nesmazal ani jeden KB záznam');

-- ── (20) prázdný rozsah je chyba, ne tichý úklid všeho ───────────────────────
SELECT throws_ok(
  $$ SELECT li_dedupe_knowledge_items(ARRAY[]::text[], false) $$,
  NULL, NULL, '(20) prázdné p_categories je odmítnuto');

-- ── ostrý běh KB ─────────────────────────────────────────────────────────────
SELECT lives_ok(
  $$ SELECT li_dedupe_knowledge_items(ARRAY['pgtap_note'], false) $$,
  '(21) ostrý běh KB proběhne');

-- ── (22)(23) vlastnosti výsledku KB ──────────────────────────────────────────
SELECT is(
  (SELECT count(*) FROM knowledge_chunks
    WHERE knowledge_item_id = current_setting('dd.ki_stary')::uuid),
  0::bigint, '(22) chunky oběti odešly s ní (žádné osiřelé znění v retrievalu)');
SELECT is(
  (SELECT string_agg(id::text, ',' ORDER BY id::text)
     FROM knowledge_items WHERE category = 'pgtap_note'),
  (SELECT string_agg(id::text, ',' ORDER BY id::text) FROM (
     VALUES (current_setting('dd.ki_novy')::uuid),
            (current_setting('dd.ki_chran')::uuid),
            (current_setting('dd.ki_chran_novy')::uuid)) v(id)),
  '(23) zbyla nová verze + OBA záznamy chráněné dvojice');

SELECT * FROM finish();
ROLLBACK;
