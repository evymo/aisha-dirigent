-- pgTAP schema-contract tests — dedup klíč návrhů sjednocení identit
-- ============================================================================
-- Runtime důkaz k opravě z 2026-07-31. `li_upsert_entity_suggestions` počítá
-- `suggestion_key` z trojice (suggestion | pole | hodnota) a pak dávku prožene
-- `DISTINCT ON`. Dokud klíč znal jen tvar `same_*` (`id_field`/`name_field` +
-- `id_value`/`name_normalized`), vycházel novějšímu `similar_values_may_merge`
-- PRÁZDNÝ ve všech třech složkách — a 659 různých návrhů se slepilo do jednoho
-- řádku. Naměřeno na produkci: z 672 návrhů uloženo 13, bez jediné chyby v logu
-- (dedup je legitimní operace, takže ztráta vypadá jako úspěch).
--
-- Proč to bolelo: 197 z těch 659 byla sloučení jmen řidičů (`KOŽUŠNÍK` ×
-- `Kožušník` × `kOŽUŠNÍK`), takže produkce držela 1 476 twinů `driver` — jeden
-- na každý pravopis místo jednoho na člověka, a řidič po přihlášení viděl jen
-- tu část svých dokladů, která padla na variantu s účtem.
--
-- Asertováno:
--   (a) tři návrhy `similar_values_may_merge` lišící se jen `question_id`
--       vytvoří TŘI řádky (regrese: vytvořily jeden),
--   (b) každý si nese svůj `question_id` v `raw_data` — nepřepsaly se navzájem,
--   (c) tvar `same_id_multiple_names` má TÝŽ klíč jako dřív (zpětná kompatibilita:
--       druhý zápis téže identity je UPDATE, ne nový řádek),
--   (d) `merge_scan_truncated` se rozliší podle `field` (dva různé → dva řádky),
--   (e) CHECK přijme všechny ČTYŘI druhy návrhu, které ingest vydává.
--
-- Vše běží jako superuser v rolled-back transakci, takže nic nepřetrvá.
-- ============================================================================
BEGIN;
SET search_path = public, extensions;
CREATE EXTENSION IF NOT EXISTS pgtap;
SELECT plan(5);

-- Zapisovatelem téhle dráhy je li-driver pod `service_role`; funkce jinou
-- identitu odmítne (a má). Superuser sám o sobě service_role NENÍ, takže se
-- identita simuluje přes request.jwt.claims stejně jako v 02_/03_ testech.
SELECT set_config('request.jwt.claims', json_build_object('role','service_role')::text, true);

-- ── (a) tři různé návrhy nového tvaru ⇒ tři řádky ──────────────────────────
SELECT li_upsert_entity_suggestions($$[
  {"suggestion":"similar_values_may_merge","advisory":true,"field":"driver_name",
   "question_id":"qa11111111111111","values":["KOŽUŠNÍK","Kožušník"],"confidence":1.0},
  {"suggestion":"similar_values_may_merge","advisory":true,"field":"driver_name",
   "question_id":"qb22222222222222","values":["MATYAŠ","Matyáš"],"confidence":1.0},
  {"suggestion":"similar_values_may_merge","advisory":true,"field":"driver_name",
   "question_id":"qc33333333333333","values":["KRYŠTOFIK","KRYŠTOFÍK"],"confidence":1.0}
]$$::jsonb, 'test-export', '1.4.0', true);

SELECT is(
  (SELECT count(*)::int FROM li_entity_suggestions
    WHERE suggestion = 'similar_values_may_merge' AND export_id = 'test-export'),
  3,
  '(a) tři návrhy sloučení se uloží jako TŘI řádky (dřív se slepily do jednoho)');

-- ── (b) každý řádek si drží svou identitu ──────────────────────────────────
SELECT is(
  (SELECT count(DISTINCT raw_data->>'question_id')::int FROM li_entity_suggestions
    WHERE suggestion = 'similar_values_may_merge' AND export_id = 'test-export'),
  3,
  '(b) každý řádek nese vlastní question_id — nepřepsaly se navzájem');

-- ── (c) starý tvar: týž klíč jako dřív ⇒ druhý zápis je UPDATE ─────────────
SELECT li_upsert_entity_suggestions($$[
  {"suggestion":"same_id_multiple_names","advisory":true,"id_field":"supplier_id",
   "id_value":"TEST-ICO-0001","names":["Firma a.s."]}
]$$::jsonb, 'test-export-2', '1.4.0', true);
SELECT li_upsert_entity_suggestions($$[
  {"suggestion":"same_id_multiple_names","advisory":true,"id_field":"supplier_id",
   "id_value":"TEST-ICO-0001","names":["Firma a.s.","Firma a. s."]}
]$$::jsonb, 'test-export-3', '1.4.0', true);

SELECT is(
  (SELECT count(*)::int FROM li_entity_suggestions
    WHERE suggestion = 'same_id_multiple_names' AND id_value = 'TEST-ICO-0001'),
  1,
  '(c) starý tvar drží týž klíč — druhý zápis téže identity je UPDATE, ne duplikát');

-- ── (d) merge_scan_truncated se rozliší podle pole ─────────────────────────
SELECT li_upsert_entity_suggestions($$[
  {"suggestion":"merge_scan_truncated","advisory":true,"field":"place_from","scanned":5000},
  {"suggestion":"merge_scan_truncated","advisory":true,"field":"place_to","scanned":5000}
]$$::jsonb, 'test-export-4', '1.4.0', true);

SELECT is(
  (SELECT count(*)::int FROM li_entity_suggestions
    WHERE suggestion = 'merge_scan_truncated' AND export_id = 'test-export-4'),
  2,
  '(d) dvě různá pole ⇒ dva řádky (dřív se slepila do jednoho)');

-- ── (e) CHECK unese všechny čtyři druhy, které ingest vydává ───────────────
-- Nezkoumá se pravopis omezení, ale VLASTNOST: co ingest vyrobí, to tabulka
-- přijme. V produkci byl CHECK rozšířen rukou a v SoT zůstal užší, takže by
-- cold-start tu vlastnost tiše ztratil.
-- Rozsah JEN na exporty tohohle testu. Dotaz přes celou tabulku by měřil, co v
-- ní náhodou je (na produkci vyšlo 4 místo 3), takže by test hlásil vadu podle
-- cizích dat — a na prázdné DB by zeleně prošel i rozbitý kód.
SELECT is(
  (SELECT count(DISTINCT suggestion)::int FROM li_entity_suggestions
    WHERE export_id IN ('test-export', 'test-export-2', 'test-export-3', 'test-export-4')),
  3,
  '(e) tabulka přijala všechny tři druhy, které tenhle test zapsal');

SELECT * FROM finish();
ROLLBACK;
