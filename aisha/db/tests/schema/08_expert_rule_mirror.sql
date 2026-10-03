-- pgTAP schema-contract tests — expert_rule → knowledge_items mirror (Brick0/1)
-- ============================================================================
-- Runtime proof for the corpus fix that makes authoritative expert_rules
-- retrievable. Two stacked bugs kept them out of the RAG corpus: the sync trigger
-- fired AFTER UPDATE only (rules are created by INSERT) and — after Brick4 widened
-- idx_knowledge_items_source_unique to include locale — the sync's upsert
-- ON CONFLICT (source_type, source_id) lost its backing index. This suite inserts an
-- expert_rule as a fixture and proves it mirrors on CREATE, and that re-firing the
-- sync upserts (does not duplicate). Runs UNSEEDED as superuser in a rolled-back txn.
-- ============================================================================
BEGIN;
SET search_path = public, extensions;
CREATE EXTENSION IF NOT EXISTS pgtap;
SELECT plan(3);

-- The mirror writes locale='global' (FK → supported_languages); seed the sentinel.
-- ⛔ NAMĚŘENO 2026-09-13: seed (core/02_languages.sql) nese tytéž kódy s jinými
-- hodnotami (cs/en is_default, name_native). DO NOTHING by nad DB se seedem nechal
-- SEEDOVÝ řádek a test by běžel nad jinými daty než v CI (bez seedu). DO UPDATE =
-- fixture vyhrává v obou. Brána: pgtap-fixture-nekoliduje-se-seedem.gate.test.ts.
INSERT INTO supported_languages (code, name_native, name_key, is_active, is_default, sort_order)
  VALUES ('global', 'Global', 'languages.global.name', true, false, 0)
  ON CONFLICT (code) DO UPDATE SET
    name_native = EXCLUDED.name_native, name_key = EXCLUDED.name_key,
    is_active = EXCLUDED.is_active, is_default = EXCLUDED.is_default, sort_order = EXCLUDED.sort_order;

SELECT set_config('er.id', gen_random_uuid()::text, true);

-- Identita se DEKLARUJE, nedědí se z díry v guardu.
--
-- Vložení do expert_rules spustí trigger → ensure_stack_default_story(), jejíž
-- deny-guard chce service_role nebo admin/staff. Do 2026-08-04 tenhle test
-- žádnou identitu nenastavoval a PROŠEL — protože guard porovnával claims
-- inline, `current_setting('request.jwt.claims', true)` bez claims vrací NULL,
-- a `NOT NULL` je NULL, takže se `RAISE` nikdy neprovedl. Test tedy stál na
-- fail-open chování, ne na oprávnění.
--
-- Jakmile guard začal číst roli přes `public.is_service_role()` (COALESCE →
-- false, guard je totální), test správně narazil na `Unauthorized`. Opravou je
-- deklarovat identitu — stejně jako to dělají sesterské suity (31_twin_relations,
-- 25_acs_core, 15_ai_decision_lens …) — ne vracet guardu tu díru.
SELECT set_config('request.jwt.claims',
  json_build_object('role', 'service_role')::text, true);

-- ⛔ 2026-09-30: trigger pravidel (fn_notify_rule_change) už NEVOLÁ ensure_stack_default_story()
-- — story_id nechá NULL a kotvu doplní BEFORE INSERT trigger ai_runs vyhledáním. Vyhledání
-- stack-default story nezakládá (chybí-li, je to vada nasazení — seed ji zakládá), takže
-- ji tahle NESEEDOVANÁ suita deklaruje jako fixturu sama, jako jazyk výš.
DO $$ BEGIN PERFORM public.ensure_stack_default_story(); END $$;

-- ════════════════════════════════════════════════════════════════════════════
-- (1) CREATE: inserting an expert_rule mirrors it into knowledge_items.
-- ════════════════════════════════════════════════════════════════════════════
-- author_partner_id is NOT NULL but carries no FK; the sync looks up the display
-- name in partner_profiles (none here ⇒ NULL author, which is fine).
INSERT INTO public.expert_rules (id, slug, title, summary, body_markdown, author_partner_id, status, visibility, version)
  VALUES (current_setting('er.id')::uuid, 'er-mirror-test', 'ER Mirror Test',
          'summary', 'body markdown', gen_random_uuid(), 'published', 'public', 1);

SELECT is(
  (SELECT count(*)::int FROM knowledge_items
     WHERE item_type = 'expert_rule' AND source_type = 'guild_db'
       AND source_id = current_setting('er.id')::uuid),
  1,
  '(1) inserting an expert_rule mirrors it into knowledge_items on CREATE (AFTER INSERT)');

-- The mirrored row carries the source_slug = the rule slug (retrieval label vocab).
SELECT is(
  (SELECT source_slug FROM knowledge_items
     WHERE item_type = 'expert_rule' AND source_id = current_setting('er.id')::uuid),
  'er-mirror-test',
  '(2) the mirrored knowledge_item carries source_slug = the expert_rule slug');

-- ════════════════════════════════════════════════════════════════════════════
-- (3) UPSERT-SAFE: re-firing the sync (an UPDATE) does not duplicate — the
--     ON CONFLICT (source_type, source_id, locale) matches the widened index.
-- ════════════════════════════════════════════════════════════════════════════
UPDATE public.expert_rules SET title = 'ER Mirror Test v2' WHERE id = current_setting('er.id')::uuid;
SELECT is(
  (SELECT count(*)::int FROM knowledge_items
     WHERE item_type = 'expert_rule' AND source_id = current_setting('er.id')::uuid),
  1,
  '(3) re-firing the sync (UPDATE) upserts, not duplicates (locale-widened ON CONFLICT)');

SELECT * FROM finish();
ROLLBACK;
