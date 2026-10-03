-- pgTAP schema-contract tests — KB zápis nese provenienci, replay neduplikuje
-- ============================================================================
-- Vlastnost, kterou tenhle soubor hlídá: **dvojí zápis TÉHOŽ zdroje smí vyrobit
-- nejvýš jeden záznam.** Bez ní každý replay balíčku přidá celou další kopii —
-- naměřeno na produkci 2026-07-30: 217 160 KB položek, z toho 137 097
-- duplicitních (63 %), a 63 376 strojově ingestovaných dokladů k nerozeznání
-- od ručních poznámek (source_type='manual', prázdný source_slug).
--
-- Testuje se vlastnost, ne implementace: nezajímá nás, JAK si funkce záznam
-- najde, ale že druhý zápis týchž souřadnic vrátí TOTÉŽ id a obsah aktualizuje.
--
-- Runs UNSEEDED as superuser (FK/triggery vypnuty jen pro fixture). Rolled back.
-- ============================================================================
BEGIN;
SET search_path = public, extensions;
CREATE EXTENSION IF NOT EXISTS pgtap;
SELECT plan(7);

SELECT set_config('kb.story', gen_random_uuid()::text, true);
SELECT set_config('kb.slug',  'test-doc-' || substr(md5(random()::text), 1, 12), true);
SELECT set_config('request.jwt.claims', json_build_object('role', 'service_role')::text, true);

SET session_replication_role = replica;
INSERT INTO partner_stories (id, title) VALUES (current_setting('kb.story')::uuid, 'pgtap kb identita');
SET session_replication_role = origin;
-- ⛔ NAMĚŘENO 2026-09-13: seed (core/02_languages.sql) nese tytéž kódy s jinými
-- hodnotami (cs/en is_default, name_native). DO NOTHING by nad DB se seedem nechal
-- SEEDOVÝ řádek a test by běžel nad jinými daty než v CI (bez seedu). DO UPDATE =
-- fixture vyhrává v obou. Brána: pgtap-fixture-nekoliduje-se-seedem.gate.test.ts.
INSERT INTO supported_languages (code, name_native, name_key, is_active, is_default, sort_order)
  VALUES ('cs', 'Cestina', 'languages.cs.name', true, false, 1)
  ON CONFLICT (code) DO UPDATE SET
    name_native = EXCLUDED.name_native, name_key = EXCLUDED.name_key,
    is_active = EXCLUDED.is_active, is_default = EXCLUDED.is_default, sort_order = EXCLUDED.sort_order;

-- ── (1)(2) podpis: nový je 14-arg a starý 11-arg NESMÍ zůstat ────────────────
-- Dvě varianty, kde delší má zbytek s DEFAULTem, znamenají „function is not
-- unique" u každého volání s 11 argumenty — proto se stará dropuje.
SELECT has_function('public', 'upsert_story_knowledge_item_audited',
  ARRAY['uuid','uuid','text','text','text','text','text','text[]','text','text','text','text','text','text'],
  '(1) zápisní RPC umí přijmout provenienci zdroje');
SELECT is(
  (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'upsert_story_knowledge_item_audited'),
  1::bigint, '(2) existuje právě JEDNA varianta — žádná nejednoznačnost volání');

-- ── první zápis ─────────────────────────────────────────────────────────────
SELECT set_config('kb.id1', public.upsert_story_knowledge_item_audited(
  current_setting('kb.story')::uuid, NULL::uuid, 'dodak-TEST-1'::text,
  'první verze'::text, 'engineering_doc'::text, NULL::text, 'pgtap_kb'::text,
  '{}'::text[], NULL::text, 'private'::text, 'cs'::text,
  'local_ingest'::text, current_setting('kb.slug'), 'sha-doc-1'::text)::text, true);

-- ── (3) provenience se OPRAVDU zapsala ──────────────────────────────────────
SELECT is(
  (SELECT source_type || ' | ' || source_slug || ' | ' || source_hash
     FROM knowledge_items WHERE id = current_setting('kb.id1')::uuid),
  'local_ingest | ' || current_setting('kb.slug') || ' | sha-doc-1',
  '(3) záznam ví, ODKUD je — ne "manual" s prázdným slugem');

-- ── replay TÉHOŽ zdroje, jiný obsah ─────────────────────────────────────────
SELECT set_config('kb.id2', public.upsert_story_knowledge_item_audited(
  current_setting('kb.story')::uuid, NULL::uuid, 'dodak-TEST-1'::text,
  'druhá verze (replay)'::text, 'engineering_doc'::text, NULL::text, 'pgtap_kb'::text,
  '{}'::text[], NULL::text, 'private'::text, 'cs'::text,
  'local_ingest'::text, current_setting('kb.slug'), 'sha-doc-1'::text)::text, true);

-- ── (4)(5)(6) jádro věci ────────────────────────────────────────────────────
SELECT is(current_setting('kb.id2'), current_setting('kb.id1'),
  '(4) replay vrátil TOTÉŽ id — ne nový záznam');
SELECT is(
  (SELECT count(*) FROM knowledge_items WHERE category = 'pgtap_kb'),
  1::bigint, '(5) po dvou zápisech je v KB právě JEDEN záznam');
SELECT is(
  (SELECT body_markdown FROM knowledge_items WHERE id = current_setting('kb.id1')::uuid),
  'druhá verze (replay)', '(6) replay obsah AKTUALIZOVAL, nenechal starý');

-- ── (7) replay bez provenience ji nesmí smazat ──────────────────────────────
-- Ruční editace přes tutéž funkci (bez source_* polí) je legitimní; nesmí ale
-- záznamu vzít to, čím byl identifikovaný, jinak by příští replay udělal kopii.
SELECT public.upsert_story_knowledge_item_audited(
  current_setting('kb.story')::uuid, current_setting('kb.id1')::uuid, NULL::text,
  'ruční oprava'::text, NULL::text, NULL::text, NULL::text,
  NULL::text[], NULL::text, NULL::text, NULL::text,
  NULL::text, NULL::text, NULL::text);
SELECT is(
  (SELECT source_slug FROM knowledge_items WHERE id = current_setting('kb.id1')::uuid),
  current_setting('kb.slug'), '(7) ruční editace nesmazala provenienci');

SELECT * FROM finish();
ROLLBACK;
