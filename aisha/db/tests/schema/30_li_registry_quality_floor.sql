-- pgTAP schema-contract tests — brána monotonicity registru (quality floor)
-- ============================================================================
-- li_upsert_source_registry byl idempotentní, ale NE monotónní: pozdější balík
-- vždycky vyhrál. 2026-07-30 tak balík z neverzovaného lokálního běhu přepsal
-- smlouvy a shodil 11 z 20 polí — a produkce od té doby nesla poslední, co
-- někdo shodil, ne nejlepší, co se kdy naměřilo.
--
-- Testované vlastnosti (vlastnosti, ne pravopis):
--   · li_usable_field_count počítá jen pole s neprázdnou 'value' — obal po
--     zamítnutých branách se nepočítá;
--   · chudší upsert (< ½ použitelných polí) NEPŘEPÍŠE existující vytěžení,
--     řádek si drží i provenienci balíku, který obsah skutečně vyrobil,
--     a návrat to přizná v kept_better;
--   · bohatší upsert projde beze změny chování (brána chrání před regresí,
--     ne před opravou);
--   · prázdné existující vytěžení bránu neaktivuje — cokoli je lepší než nic.
--
-- Fixture používá vlastní doc_type ('pgtap_qfloor') a TENTÝŽ sha pro upserty,
-- takže se nikdy nepotká s rekey větví (ta vyžaduje sha <> sha) ani se
-- skutečnými daty. Runs UNSEEDED as superuser, rolled back.
-- ============================================================================
BEGIN;
SET search_path = public, extensions;
CREATE EXTENSION IF NOT EXISTS pgtap;
SELECT plan(13);

-- ── Identity: RPC je service/admin-only ──────────────────────────────────────
SELECT set_config('request.jwt.claims', '{"role":"service_role"}', true);

-- ── Helper ───────────────────────────────────────────────────────────────────
SELECT is(
  public.li_usable_field_count(jsonb_build_object(
    'a', jsonb_build_object('value', 'x'),
    'b', jsonb_build_object('value', ''),
    'c', jsonb_build_object('confidence', 1.0)
  )),
  1,
  'li_usable_field_count: prázdná value ani obal bez value se nepočítají'
);
SELECT is(public.li_usable_field_count('{}'::jsonb), 0,
  'li_usable_field_count: prázdný objekt = 0');
SELECT is(public.li_usable_field_count(NULL), 0,
  'li_usable_field_count: NULL = 0 (fail-closed, ne výjimka)');

-- ── Bohatý základ: 4 použitelná pole z balíku "rich" ─────────────────────────
SELECT is(
  (public.li_upsert_source_registry(
    jsonb_build_array(jsonb_build_object(
      'source_sha256', repeat('a', 64),
      'source_slug', 'pgtap-qfloor-doc',
      'doc_type', 'pgtap_qfloor',
      'filename', 'qfloor-1.json',
      'fields', jsonb_build_object(
        'counterparty',  jsonb_build_object('value', 'Skanska a.s.'),
        'customer_id',   jsonb_build_object('value', '26271303'),
        'goods_value',   jsonb_build_object('value', '9994.60'),
        'delivery_date', jsonb_build_object('value', '2026-07-01')
      )
    )),
    'pgtap-export-rich', 'pgtap-engine', true
  ))->>'inserted',
  '1',
  'bohatý základ se vloží'
);

-- ── Chudší balík (1 ze 4 polí): brána drží ───────────────────────────────────
SELECT results_eq(
  $$ SELECT (r->>'kept_better')::int, (r->>'updated')::int, (r->>'total')::int
     FROM public.li_upsert_source_registry(
       jsonb_build_array(jsonb_build_object(
         'source_sha256', repeat('a', 64),
         'source_slug', 'pgtap-qfloor-doc',
         'doc_type', 'pgtap_qfloor',
         'filename', 'qfloor-1.json',
         'fields', jsonb_build_object(
           'counterparty', jsonb_build_object('value', 'Skansk')
         )
       )),
       'pgtap-export-poor', 'pgtap-engine', true
     ) AS r $$,
  $$ VALUES (1, 0, 1) $$,
  'chudší upsert: kept_better=1, updated=0, total dál hlásí zpracovaný řádek'
);
SELECT is(
  (SELECT public.li_usable_field_count(fields) FROM li_source_registry
    WHERE source_sha256 = repeat('a', 64)),
  4,
  'vytěžení po chudším balíku zůstalo čtyřpolové'
);
SELECT is(
  (SELECT fields->'counterparty'->>'value' FROM li_source_registry
    WHERE source_sha256 = repeat('a', 64)),
  'Skanska a.s.',
  'hodnota pole zůstala z bohatšího balíku'
);
SELECT is(
  (SELECT export_id FROM li_source_registry WHERE source_sha256 = repeat('a', 64)),
  'pgtap-export-rich',
  'provenience ukazuje na balík, který obsah skutečně vyrobil'
);

-- ── Bohatší balík (5 polí): projde ───────────────────────────────────────────
SELECT results_eq(
  $$ SELECT (r->>'kept_better')::int, (r->>'updated')::int
     FROM public.li_upsert_source_registry(
       jsonb_build_array(jsonb_build_object(
         'source_sha256', repeat('a', 64),
         'source_slug', 'pgtap-qfloor-doc',
         'doc_type', 'pgtap_qfloor',
         'filename', 'qfloor-1.json',
         'fields', jsonb_build_object(
           'counterparty',  jsonb_build_object('value', 'Skanska a.s.'),
           'customer_id',   jsonb_build_object('value', '26271303'),
           'goods_value',   jsonb_build_object('value', '9994.60'),
           'delivery_date', jsonb_build_object('value', '2026-07-01'),
           'driver_name',   jsonb_build_object('value', 'Novák')
         )
       )),
       'pgtap-export-richer', 'pgtap-engine', true
     ) AS r $$,
  $$ VALUES (0, 1) $$,
  'bohatší upsert projde: kept_better=0, updated=1'
);
SELECT is(
  (SELECT public.li_usable_field_count(fields) FROM li_source_registry
    WHERE source_sha256 = repeat('a', 64)),
  5,
  'vytěžení je po bohatším balíku pětipolové'
);
SELECT is(
  (SELECT export_id FROM li_source_registry WHERE source_sha256 = repeat('a', 64)),
  'pgtap-export-richer',
  'provenience se posunula s přepisem'
);

-- ── Prázdný základ: brána se neaktivuje, cokoli je lepší než nic ─────────────
SELECT is(
  (public.li_upsert_source_registry(
    jsonb_build_array(jsonb_build_object(
      'source_sha256', repeat('b', 64),
      'source_slug', 'pgtap-qfloor-prazdny',
      'doc_type', 'pgtap_qfloor',
      'filename', 'qfloor-2.json',
      'fields', '{}'::jsonb
    )),
    'pgtap-export-empty', 'pgtap-engine', true
  ))->>'inserted',
  '1',
  'řádek s prázdným vytěžením se vloží'
);
SELECT results_eq(
  $$ SELECT (r->>'kept_better')::int, (r->>'updated')::int
     FROM public.li_upsert_source_registry(
       jsonb_build_array(jsonb_build_object(
         'source_sha256', repeat('b', 64),
         'source_slug', 'pgtap-qfloor-prazdny',
         'doc_type', 'pgtap_qfloor',
         'filename', 'qfloor-2.json',
         'fields', jsonb_build_object(
           'counterparty', jsonb_build_object('value', 'Metrostav a.s.')
         )
       )),
       'pgtap-export-first-real', 'pgtap-engine', true
     ) AS r $$,
  $$ VALUES (0, 1) $$,
  'nad prázdným základem projde i jednopolový balík'
);

SELECT * FROM finish();
ROLLBACK;
