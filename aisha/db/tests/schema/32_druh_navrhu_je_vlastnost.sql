-- pgTAP schema-contract test — druh návrhu entity je VLASTNOST, ne výčet.
-- ============================================================================
-- ⭐ Vzniklo z vady, která padla TŘIKRÁT (07-31 dvakrát, 08-03 potřetí):
-- `li_entity_suggestions.suggestion` měl uzavřený CHECK se jmény druhů, které
-- ingest zrovna vydával. Engine slovník rozšířil (naposledy o
-- `value_shape_foreign_to_field`) a čtyřprvkový výčet odmítl CELÝ balíček
-- 44 320 dokladů — jediný neznámý řádek zastavil replay evidence i KB.
--
-- Uzavřený výčet svazuje platformu s enginem do lockstepu a přitom nic nechrání:
-- nikdo na hodnotu nespíná a doktrínu „advisory, nikdy vazba" drží
-- `advisory_check`. Kontrakt proto testuje TVAR.
--
-- Testované vlastnosti (vlastnosti, ne pravopis):
--   · druh, který engine teprve vymyslí, projde — pokud je to slug;
--   · dosavadní čtyři druhy projdou beze změny (oprava není regrese);
--   · nepořádek NEPROJDE: prázdno, mezera, verzálky, HTML, příliš krátké;
--   · doktrína drží dál — `advisory = false` je odmítnuto bez ohledu na druh.
--
-- Fixture zapisuje PŘÍMO do tabulky (ne přes RPC): předmětem testu je kontrakt
-- sloupce, ne autorizace zapisovatele. Runs UNSEEDED as superuser, rolled back.
-- ============================================================================
BEGIN;
SET search_path = public, extensions;
CREATE EXTENSION IF NOT EXISTS pgtap;
SELECT plan(11);

-- ── A. slovník smí RŮST ─────────────────────────────────────────────────────
-- Přesně ten druh, na kterém 08-03 padl balíček.
SELECT lives_ok(
  $$INSERT INTO public.li_entity_suggestions (suggestion_key, suggestion)
    VALUES ('pgtap-a1', 'value_shape_foreign_to_field')$$,
  'pátý druh (value_shape_foreign_to_field) projde — na něm padl balíček');

-- Druh, který zatím NEEXISTUJE nikde: kontrakt nesmí znát budoucí slovník.
SELECT lives_ok(
  $$INSERT INTO public.li_entity_suggestions (suggestion_key, suggestion)
    VALUES ('pgtap-a2', 'zatim_nevymysleny_druh_navrhu')$$,
  'neznámý budoucí druh projde — kontrakt nesmí být lockstep s enginem');

-- ── B. dosavadní druhy projdou dál (oprava není regrese) ────────────────────
SELECT lives_ok(
  $$INSERT INTO public.li_entity_suggestions (suggestion_key, suggestion)
    VALUES ('pgtap-b1', 'same_id_multiple_names')$$,
  'same_id_multiple_names projde');
SELECT lives_ok(
  $$INSERT INTO public.li_entity_suggestions (suggestion_key, suggestion)
    VALUES ('pgtap-b2', 'same_name_multiple_ids')$$,
  'same_name_multiple_ids projde');
SELECT lives_ok(
  $$INSERT INTO public.li_entity_suggestions (suggestion_key, suggestion)
    VALUES ('pgtap-b3', 'similar_values_may_merge')$$,
  'similar_values_may_merge projde');
SELECT lives_ok(
  $$INSERT INTO public.li_entity_suggestions (suggestion_key, suggestion)
    VALUES ('pgtap-b4', 'merge_scan_truncated')$$,
  'merge_scan_truncated projde');

-- ── C. nepořádek NEPROJDE ───────────────────────────────────────────────────
-- Kdyby uvolnění znamenalo „cokoliv", nebyl by to kontrakt, ale jeho zrušení.
SELECT throws_ok(
  $$INSERT INTO public.li_entity_suggestions (suggestion_key, suggestion)
    VALUES ('pgtap-c1', '')$$,
  '23514', NULL, 'prázdný druh je odmítnut');
SELECT throws_ok(
  $$INSERT INTO public.li_entity_suggestions (suggestion_key, suggestion)
    VALUES ('pgtap-c2', 'dva slova')$$,
  '23514', NULL, 'mezera v druhu je odmítnuta — druh je slug, ne věta');
SELECT throws_ok(
  $$INSERT INTO public.li_entity_suggestions (suggestion_key, suggestion)
    VALUES ('pgtap-c3', '<script>x</script>')$$,
  '23514', NULL, 'značkování je odmítnuto');
SELECT throws_ok(
  $$INSERT INTO public.li_entity_suggestions (suggestion_key, suggestion)
    VALUES ('pgtap-c4', 'SAME_ID_MULTIPLE_NAMES')$$,
  '23514', NULL, 'verzálky jsou odmítnuty — jeden zápis, ne dva pro týž druh');

-- ── D. doktrína drží NEZÁVISLE na druhu ─────────────────────────────────────
-- Uvolnění druhu nesmí uvolnit to, co druh nikdy nehlídal: advisory-only.
SELECT throws_ok(
  $$INSERT INTO public.li_entity_suggestions (suggestion_key, suggestion, advisory)
    VALUES ('pgtap-d1', 'value_shape_foreign_to_field', false)$$,
  '23514', NULL, 'advisory=false odmítnuto i u nově povoleného druhu');

SELECT * FROM finish();
ROLLBACK;
