-- pgTAP schema-contract test — POLOHA TABLETU JE METAINFORMACE, NE DŮKAZ.
-- ============================================================================
-- ⭐ Rozhodnutí majitele (2026-09-18): poloha tabletu u potvrzení předání se
-- ukládá jako `device_geo` VEDLE odvozené `geo`, nikdy místo ní. Pravidlo
-- z 2026-07-28 („souřadnice od toho, koho záznam dokumentuje, důkaz není")
-- platí dál; důvěryhodnost zvyšuje až SHODA dvou nezávislých zdrojů.
--
-- Testované vlastnosti:
--   · chybějící poloha je NULL, ne vymyšlený záznam,
--   · poctivá mezera nese DŮVOD z uzavřené množiny,
--   · tvar je uzavřený — neznámý klíč, špatný typ, rozsah nebo čas = 22023,
--   · výsledek se nikdy nedá zaměnit s odvozenou polohou (geo_source `device…`),
--   · shoda (`agreement_m`) vzniká JEN proti odvozené poloze se souřadnicemi —
--     proti `unavailable` by to bylo číslo z ničeho,
--   · dispatcher klíč `device_position` přijme a zvaliduje DŘÍV, než krok
--     dokončí (vadný tvar nesmí nechat hotový krok bez evidence),
--   · klient funkci přímo nevolá (není to RPC).
--
-- Funkce na tabulky nesahá, takže fixtura není potřeba; dispatcher se volá
-- s neexistujícím krokem, kde se zastaví dřív, než by cokoli zapsal.
-- ============================================================================
BEGIN;
SET search_path = public, extensions;
CREATE EXTENSION IF NOT EXISTS pgtap;
SELECT plan(19);

-- ── Chybějící poloha ───────────────────────────────────────────────────────
SELECT is(public.evidence_device_geo(NULL, NULL), NULL,
  'SQL NULL → NULL (klient polohu neposlal)');
SELECT is(public.evidence_device_geo('null'::jsonb, NULL), NULL,
  'JSON null → NULL (offline fronta posílá devicePosition: null)');

-- ── Poctivá mezera ─────────────────────────────────────────────────────────
SELECT is(public.evidence_device_geo('{"unavailable":"denied"}', NULL),
  '{"geo_source":"device_unavailable","reason":"denied"}'::jsonb,
  'unavailable → device_unavailable s důvodem');
SELECT throws_ok($$ SELECT public.evidence_device_geo('{"unavailable":"nevim"}', NULL) $$,
  '22023', NULL, 'důvod mimo denied/disabled/timeout/error se odmítne');
SELECT throws_ok($$ SELECT public.evidence_device_geo('{"unavailable":"denied","lat":50}', NULL) $$,
  '22023', NULL, 'unavailable nesmí nést souřadnice');

-- ── Naměřená poloha bez druhého zdroje ─────────────────────────────────────
SELECT is(public.evidence_device_geo(
    '{"lat":50,"lon":14,"accuracy_m":12.5,"captured_at":"2026-09-18T10:00:00Z"}', NULL)
    - 'captured_at',
  '{"geo_source":"device","lat":50,"lon":14,"accuracy_m":12.5}'::jsonb,
  'naměřená poloha → geo_source device, bez agreement_m');
SELECT is((public.evidence_device_geo(
    '{"lat":50,"lon":14,"captured_at":"2026-09-18T10:00:00Z"}', NULL)->>'captured_at')::timestamptz,
  '2026-09-18T10:00:00Z'::timestamptz,
  'captured_at se zachová jako okamžik měření');
SELECT ok(NOT (public.evidence_device_geo(
    '{"lat":50,"lon":14,"accuracy_m":null,"captured_at":"2026-09-18T10:00:00Z"}', NULL) ? 'accuracy_m'),
  'accuracy_m null se nevymýšlí — klíč chybí');

-- ── Uzavřený tvar ──────────────────────────────────────────────────────────
SELECT throws_ok($$ SELECT public.evidence_device_geo('{"lat":50,"lon":14,"captured_at":"2026-09-18T10:00:00Z","alt":300}', NULL) $$,
  '22023', NULL, 'neznámý klíč se odmítne');
SELECT throws_ok($$ SELECT public.evidence_device_geo('{"lat":"50","lon":14,"captured_at":"2026-09-18T10:00:00Z"}', NULL) $$,
  '22023', NULL, 'lat jako text se odmítne');
SELECT throws_ok($$ SELECT public.evidence_device_geo('{"lat":91,"lon":14,"captured_at":"2026-09-18T10:00:00Z"}', NULL) $$,
  '22023', NULL, 'lat mimo rozsah se odmítne');
SELECT throws_ok($$ SELECT public.evidence_device_geo('{"lat":50,"lon":14,"accuracy_m":-1,"captured_at":"2026-09-18T10:00:00Z"}', NULL) $$,
  '22023', NULL, 'záporná přesnost se odmítne');
SELECT throws_ok($$ SELECT public.evidence_device_geo('{"lat":50,"lon":14}', NULL) $$,
  '22023', NULL, 'poloha bez času měření se odmítne');
SELECT throws_ok($$ SELECT public.evidence_device_geo('{"lat":50,"lon":14,"captured_at":"včera"}', NULL) $$,
  '22023', NULL, 'nečitelný čas měření je 22023, ne 22007');

-- ── Shoda dvou zdrojů ──────────────────────────────────────────────────────
-- 0,001° zeměpisné šířky = 111,19 m (R = 6 371 km); haversine to musí dát.
SELECT is(public.evidence_device_geo(
    '{"lat":50.001,"lon":14,"captured_at":"2026-09-18T10:00:00Z"}',
    '{"geo_source":"arrival_signal","lat":50,"lon":14}')->'agreement_m',
  '111'::jsonb,
  'agreement_m = vzdálenost od odvozené polohy v metrech');
SELECT ok(NOT (public.evidence_device_geo(
    '{"lat":50,"lon":14,"captured_at":"2026-09-18T10:00:00Z"}',
    '{"geo_source":"unavailable","reason":"no_signal"}') ? 'agreement_m'),
  'proti odvozené poloze bez souřadnic se shoda nepočítá');

-- ── Dispatcher ─────────────────────────────────────────────────────────────
-- Neexistující krok: odvozená poloha vrátí `unavailable`, validace polohy
-- tabletu proběhne PŘED complete_workflow_step, takže vadný tvar skončí 22023.
SELECT throws_ok($$
  SELECT public.submit_evidence_review_audited('workflow_step', gen_random_uuid(), 'HUMAN_CONFIRMED',
    NULL, '{"device_position":{"lat":"x"}}'::jsonb)
$$, '22023', 'device_position needs numeric lat and lon',
  'dispatcher device_position přijme a zvaliduje před dokončením kroku');
-- Platný tvar projde validací a zastaví se až na neexistujícím kroku.
SELECT throws_ok($$
  SELECT public.submit_evidence_review_audited('workflow_step', gen_random_uuid(), 'HUMAN_CONFIRMED',
    NULL, '{"device_position":{"unavailable":"timeout"}}'::jsonb)
$$, '42501', NULL,
  'platná poloha nezastaví dispatcher — rozhoduje až samotný krok');

-- ── Není to RPC ────────────────────────────────────────────────────────────
SELECT ok(NOT has_function_privilege('authenticated', 'public.evidence_device_geo(jsonb, jsonb)', 'EXECUTE')
          AND NOT has_function_privilege('anon', 'public.evidence_device_geo(jsonb, jsonb)', 'EXECUTE'),
  'klient evidence_device_geo přímo nevolá');

SELECT * FROM finish();
ROLLBACK;
