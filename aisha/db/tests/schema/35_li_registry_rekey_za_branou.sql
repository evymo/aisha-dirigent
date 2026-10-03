-- pgTAP schema-contract tests — překlíčování (rekey) NESMÍ předběhnout bránu monotonicity
-- ============================================================================
-- li_upsert_source_registry dělá dvě věci, které spolu musí souhlasit:
--   · REKEY: identita dokladu je `filename`, `source_sha256` je verze obsahu —
--     existující řádek téhož jména se překlíčuje na příchozí sha a následný
--     ON CONFLICT ho aktualizuje na místě;
--   · BRÁNA MONOTONICITY: příchozí vytěžení s méně než polovinou použitelných
--     polí existující NEPŘEPÍŠE (kept_better).
--
-- ⛔ PODEZŘENÍ Z RECENZE (aisha-team 2026-09-23): rekey běží PŘED bránou.
-- Když brána přepis odmítne, řádek už nese NOVÝ sha se STARÝM obsahem —
-- otisk a obsah si přestanou odpovídat (a `doc_slug`/klíč binárky
-- `<sha256>.pdf` ukazují na jiný soubor, než ze kterého je vytěžení).
-- Další replay staršího obsahu pak překlíčuje zpět.
--
-- Testované vlastnosti:
--   · po ODMÍTNUTÉM chudším balíku nese řádek dál PŮVODNÍ sha i obsah
--     a návrat nehlásí rekey;
--   · bohatší balík se překlíčuje i přepíše (refresh téhož dokladu funguje);
--   · chudší replay po bohatším refreshi otisk nezmění;
--   · prázdné existující vytěžení bránu neaktivuje — rekey projde.
--
-- Fixture: vlastní doc_type ('pgtap_rekey') a jména souborů, takže se nepotká
-- se skutečnými daty. Runs UNSEEDED as superuser, rolled back.
-- ============================================================================
BEGIN;
SET search_path = public, extensions;
CREATE EXTENSION IF NOT EXISTS pgtap;
SELECT plan(13);

SELECT set_config('request.jwt.claims', '{"role":"service_role"}', true);

-- ── Bohatý základ: 4 použitelná pole, sha C ─────────────────────────────────
SELECT is(
  (public.li_upsert_source_registry(
    jsonb_build_array(jsonb_build_object(
      'source_sha256', repeat('c', 64),
      'source_slug', 'pgtap-rekey-doc',
      'doc_type', 'pgtap_rekey',
      'filename', 'pgtap-rekey-1.json',
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

-- ── Chudší balík TÉHOŽ dokladu (1 ze 4 polí), jiný sha D: brána odmítne ──────
SELECT results_eq(
  $$ SELECT (r->>'kept_better')::int, (r->>'rekeyed')::int
     FROM public.li_upsert_source_registry(
       jsonb_build_array(jsonb_build_object(
         'source_sha256', repeat('d', 64),
         'source_slug', 'pgtap-rekey-doc',
         'doc_type', 'pgtap_rekey',
         'filename', 'pgtap-rekey-1.json',
         'fields', jsonb_build_object(
           'counterparty', jsonb_build_object('value', 'Skansk')
         )
       )),
       'pgtap-export-poor', 'pgtap-engine', true
     ) AS r $$,
  $$ VALUES (1, 0) $$,
  'odmítnutý chudší balík: kept_better=1 a návrat NEhlásí rekey'
);
SELECT is(
  (SELECT count(*)::int FROM li_source_registry WHERE filename = 'pgtap-rekey-1.json'),
  1,
  'doklad má dál jediný řádek'
);
-- ⭐ KONTROLNÍ VZOREK: tady dnešní kód padá (řádek nese sha D se starým obsahem)
SELECT is(
  (SELECT source_sha256 FROM li_source_registry WHERE filename = 'pgtap-rekey-1.json'),
  repeat('c', 64),
  'po odmítnutí nese řádek PŮVODNÍ sha — otisk patří k obsahu, který drží'
);
SELECT is(
  (SELECT public.li_usable_field_count(fields) FROM li_source_registry
    WHERE filename = 'pgtap-rekey-1.json'),
  4,
  'obsah zůstal čtyřpolový (brána drží)'
);
SELECT is(
  (SELECT count(*)::int FROM li_source_registry WHERE source_sha256 = repeat('d', 64)),
  0,
  'sha odmítnutého balíku nenese žádný řádek'
);

-- ── Bohatší refresh (5 polí), sha E: překlíčuje se i přepíše ─────────────────
SELECT results_eq(
  $$ SELECT (r->>'kept_better')::int, (r->>'updated')::int, (r->>'rekeyed')::int
     FROM public.li_upsert_source_registry(
       jsonb_build_array(jsonb_build_object(
         'source_sha256', repeat('e', 64),
         'source_slug', 'pgtap-rekey-doc',
         'doc_type', 'pgtap_rekey',
         'filename', 'pgtap-rekey-1.json',
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
  $$ VALUES (0, 1, 1) $$,
  'bohatší refresh téhož dokladu: překlíčován i přepsán'
);
SELECT results_eq(
  $$ SELECT source_sha256, public.li_usable_field_count(fields), export_id
       FROM li_source_registry WHERE filename = 'pgtap-rekey-1.json' $$,
  $$ VALUES (repeat('e', 64), 5, 'pgtap-export-richer'::text) $$,
  'po refreshi: sha E, pět polí, provenience z bohatšího balíku'
);

-- ── Chudší replay po refreshi: otisk se nesmí vrátit na D ────────────────────
SELECT results_eq(
  $$ SELECT (r->>'kept_better')::int, (r->>'rekeyed')::int
     FROM public.li_upsert_source_registry(
       jsonb_build_array(jsonb_build_object(
         'source_sha256', repeat('d', 64),
         'source_slug', 'pgtap-rekey-doc',
         'doc_type', 'pgtap_rekey',
         'filename', 'pgtap-rekey-1.json',
         'fields', jsonb_build_object(
           'counterparty', jsonb_build_object('value', 'Skansk')
         )
       )),
       'pgtap-export-poor', 'pgtap-engine', true
     ) AS r $$,
  $$ VALUES (1, 0) $$,
  'chudší replay po refreshi: odmítnut, bez rekey'
);
SELECT is(
  (SELECT source_sha256 FROM li_source_registry WHERE filename = 'pgtap-rekey-1.json'),
  repeat('e', 64),
  'po chudším replayi nese řádek dál sha E'
);

-- ── Prázdné existující vytěžení bránu neaktivuje: rekey projde ───────────────
SELECT is(
  (public.li_upsert_source_registry(
    jsonb_build_array(jsonb_build_object(
      'source_sha256', repeat('f', 64),
      'source_slug', 'pgtap-rekey-doc-2',
      'doc_type', 'pgtap_rekey',
      'filename', 'pgtap-rekey-2.json',
      'fields', '{}'::jsonb
    )),
    'pgtap-export-empty', 'pgtap-engine', true
  ))->>'inserted',
  '1',
  'prázdný základ se vloží'
);
-- (volání a čtení ve DVOU příkazech: jeden příkaz sdílí snímek a zápis funkce by neviděl)
SELECT is(
  (public.li_upsert_source_registry(
    jsonb_build_array(jsonb_build_object(
      'source_sha256', repeat('0', 63) || '1',
      'source_slug', 'pgtap-rekey-doc-2',
      'doc_type', 'pgtap_rekey',
      'filename', 'pgtap-rekey-2.json',
      'fields', jsonb_build_object('counterparty', jsonb_build_object('value', 'Novák s.r.o.'))
    )),
    'pgtap-export-first', 'pgtap-engine', true
  )->>'rekeyed')::int,
  1,
  'nad prázdným vytěžením se rekey provede (cokoli je lepší než nic)'
);
SELECT results_eq(
  $$ SELECT source_sha256, public.li_usable_field_count(fields)
       FROM li_source_registry WHERE filename = 'pgtap-rekey-2.json' $$,
  $$ VALUES (repeat('0', 63) || '1', 1) $$,
  'a řádek nese nový sha i nový obsah'
);

SELECT * FROM finish();
ROLLBACK;
