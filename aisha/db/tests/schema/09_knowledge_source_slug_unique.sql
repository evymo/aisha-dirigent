-- pgTAP schema-contract tests — knowledge_items (source_slug, locale) unique (#33)
-- ============================================================================
-- Structural prevention of source-identified knowledge_item duplication (the
-- chat-delegation x17 class, #547). The partial unique idx_knowledge_items_source_
-- slug_locale_unique on (source_slug, locale) WHERE source_slug IS NOT NULL must:
--   (1) exist; (2) reject a second row with the same (source_slug, locale);
--   (3) ALLOW the same slug at a different locale (Brick4 locale variants must coexist
--       — a bare UNIQUE(source_slug) would wrongly forbid this); (4) leave NULL-slug
--   rows unconstrained (ad-hoc items are not slug-identified).
-- Runs UNSEEDED as superuser in a rolled-back txn.
-- ============================================================================
BEGIN;
SET search_path = public, extensions;
CREATE EXTENSION IF NOT EXISTS pgtap;
SELECT plan(4);

-- locale is FK -> supported_languages; seed the codes this suite uses (runs unseeded).
-- ⛔ NAMĚŘENO 2026-09-13: seed (core/02_languages.sql) nese tytéž kódy s jinými
-- hodnotami (cs/en is_default, name_native). DO NOTHING by nad DB se seedem nechal
-- SEEDOVÝ řádek a test by běžel nad jinými daty než v CI (bez seedu). DO UPDATE =
-- fixture vyhrává v obou. Brána: pgtap-fixture-nekoliduje-se-seedem.gate.test.ts.
INSERT INTO supported_languages (code, name_native, name_key, is_active, is_default, sort_order)
  VALUES ('global', 'Global', 'languages.global.name', true, false, 0),
         ('cs', 'Cestina', 'languages.cs.name', true, false, 1)
  ON CONFLICT (code) DO UPDATE SET
    name_native = EXCLUDED.name_native, name_key = EXCLUDED.name_key,
    is_active = EXCLUDED.is_active, is_default = EXCLUDED.is_default, sort_order = EXCLUDED.sort_order;

-- (1) the partial unique index exists
SELECT has_index(
  'public', 'knowledge_items', 'idx_knowledge_items_source_slug_locale_unique',
  '(1) (source_slug, locale) partial unique index exists');

-- fixture: one source-identified item at locale 'global'
SELECT set_config('ki.slug', 'u33-' || gen_random_uuid()::text, true);
INSERT INTO knowledge_items
  (item_type, source_type, source_slug, locale, title, body_markdown, status, visibility, version)
  VALUES ('domain_doc', 'manual', current_setting('ki.slug'), 'global', 't1', 'b', 'active', 'public', 1);

-- (2) a second row with the same (source_slug, locale) is rejected (unique_violation)
SELECT throws_ok(
  format($q$INSERT INTO knowledge_items (item_type, source_type, source_slug, locale, title, body_markdown, status, visibility, version) VALUES ('domain_doc','manual',%L,'global','t2','b','active','public',1)$q$,
         current_setting('ki.slug')),
  '23505', NULL,
  '(2) a duplicate (source_slug, locale) is rejected by the unique');

-- (3) the SAME slug at a DIFFERENT locale is allowed (Brick4 locale variant)
SELECT lives_ok(
  format($q$INSERT INTO knowledge_items (item_type, source_type, source_slug, locale, title, body_markdown, status, visibility, version) VALUES ('domain_doc','manual',%L,'cs','t3','b','active','public',1)$q$,
         current_setting('ki.slug')),
  '(3) the same source_slug at a different locale is allowed (locale variant coexists)');

-- (4) NULL source_slug rows are not slug-identified → unconstrained (two allowed)
SELECT lives_ok(
  $q$INSERT INTO knowledge_items (item_type, source_type, source_slug, locale, title, body_markdown, status, visibility, version) VALUES ('domain_doc','manual',NULL,'global','n1','b','active','public',1),('domain_doc','manual',NULL,'global','n2','b','active','public',1)$q$,
  '(4) NULL source_slug rows are not constrained by the slug unique');

SELECT * FROM finish();
ROLLBACK;
