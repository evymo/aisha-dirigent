-- ============================================================================
-- Source of Truth: li_upsert_source_registry
-- Popis: Batch upsert evidenčního registru dokladů z local-ingest. Volá
--        svc-source-broker li-driver po přečtení verify-gated export balíčku.
--        Idempotence přes source_sha256 (obsahová identita dokladu) — replay
--        téhož exportu nevytvoří duplicity. Jediný writer registru (RPC-only).
-- Bezpečnost: SECURITY DEFINER + REVOKE/GRANT; service_role / admin / staff.
-- Audit: li_source_registry.upsert_completed s počty (bez PII).
-- ============================================================================

CREATE OR REPLACE FUNCTION public.li_upsert_source_registry(
  p_rows           jsonb,
  p_export_id      text DEFAULT NULL,
  p_engine_version text DEFAULT NULL,
  p_verify_ok      boolean DEFAULT false
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  -- Kanonický boolean-NOT-NULL service check (is_service_role.sql, #588):
  -- deny-guard níže tak fail-CLOSED i bez role claimu.
  v_is_service boolean := public.is_service_role();
  v_batch      jsonb;
  v_total      integer;
  v_updated    integer;
  v_inserted   integer;
  v_written    integer := 0;
  v_kept_better integer := 0;
  v_rekeyed    integer := 0;
  -- sha příchozích verzí, které by brána monotonicity odmítla u dokladu, jenž
  -- by se jinak překlíčoval — ty se nepřeklíčují ani nevkládají (viz níže)
  v_odmitnute  text[]  := '{}';
  v_odmitnuto  integer := 0;
BEGIN
  -- Authorization (FIRST, před jakýmkoli přístupem k datům)
  IF NOT v_is_service AND NOT public.is_admin_or_staff() THEN
    RAISE EXCEPTION 'Unauthorized: admin, staff, or service_role required';
  END IF;

  -- Input validation
  IF p_rows IS NULL OR jsonb_typeof(p_rows) <> 'array' THEN
    RAISE EXCEPTION 'p_rows must be a jsonb array';
  END IF;

  -- Dedup podle source_sha256 — ON CONFLICT nesmí zasáhnout stejný řádek dvakrát.
  -- Poslední výskyt v dávce vyhrává (DISTINCT ON drží první po ORDER, viz níže).
  SELECT COALESCE(jsonb_agg(deduped.item), '[]'::jsonb) INTO v_batch
  FROM (
    SELECT DISTINCT ON (item->>'source_sha256') item
    FROM jsonb_array_elements(p_rows) AS item
    WHERE item->>'source_sha256' IS NOT NULL
  ) AS deduped;

  v_total := jsonb_array_length(v_batch);

  -- ── REKEY: identitou dokladu je JMÉNO, sha je jen verze obsahu ─────────────
  -- `source_sha256` = hash OBSAHU. Když se týž doklad stáhne znovu bohatší
  -- (přibude stav úhrady, položky…), obsah se změní → jiný hash → ON CONFLICT
  -- nic nenajde a vznikne DRUHÝ řádek téhož dokladu. Naměřeno 2026-07-30 na
  -- produkci: re-ingest 4 050 faktur přidal 4 050 řádků a 3 227 jmen bylo
  -- rázem dvakrát. A refresh není výjimka — úhrady se mění pořád, takže tohle
  -- je NORMÁLNÍ provoz, ne okrajový případ.
  --
  -- Schémata to celou dobu deklarovala (`doc_identity: "@filename"`), jen to
  -- nikdy nic nevyhodnocovalo: v ingestu se řetězec `doc_identity` nevyskytuje
  -- a `li_dedupe_source_registry` z komentáře schématu neexistuje. Tady se ta
  -- deklarace poprvé stává chováním: existující řádek se PŘEKLÍČUJE na nový
  -- hash a následný ON CONFLICT ho aktualizuje na místě.
  --
  -- Proč je to bezpečné (změřeno na produkci 2026-07-31, ne odhad):
  --   · na `li_source_registry` NEUKAZUJE ŽÁDNÝ cizí klíč (0 constraintů) —
  --     přepis sha nemůže osiřet vazbu,
  --   · `filename` je vyplněné u všech 63 830 řádků a je UNIKÁTNÍ (0 kolizí).
  --
  -- Fail-safe: rekey se provede JEN u jednoznačného případu — právě jeden řádek
  -- s tím jménem a příchozí hash zatím nikomu nepatří. Jinak se nedělá nic a
  -- platí dosavadní chování (nový řádek), takže dvojznačnost nikdy nepřepíše
  -- cizí doklad. Pro dva různé dokumenty téhož jména tedy zůstává stará cesta.
  --
  -- ⛔ REKEY NESMÍ PŘEDBĚHNOUT BRÁNU MONOTONICITY (níže u ON CONFLICT). Do
  -- 2026-09-23 se překlíčovalo VŽDY a brána rozhodovala až potom: chudší verze
  -- téhož dokladu (méně než ½ polí) tak řádek překlíčovala na SVŮJ sha, brána
  -- přepis odmítla a řádek nesl nový otisk se starým obsahem — `doc_slug`,
  -- `raw_data` i klíč binárky `<sha256>.pdf` ukazovaly jinam než vytěžení,
  -- a další replay bohatší verze překlíčoval zpět. Nalezeno recenzí aisha-team,
  -- potvrzeno testem 35_li_registry_rekey_za_branou. Naměřeno v produkci
  -- 2026-09-23: 0 z 69 695 řádků nese nesoulad — vada byla zatím SKRYTÁ
  -- (odmítnutí dosud jen u replaye se stejným sha), spustila by ji první chudší
  -- verze pod novým otiskem.
  -- Proto se brána vyhodnotí UŽ TADY: kandidát, kterého by odmítla, se
  -- nepřeklíčuje a jeho verze se ani NEVLOŽÍ (jinak by pod novým sha vznikl
  -- druhý řádek téhož dokladu). Započítá se do kept_better jako každé odmítnutí.
  WITH incoming AS (
    SELECT DISTINCT ON (item->>'filename')
           item->>'filename'      AS filename,
           item->>'source_sha256' AS sha,
           item->'fields'         AS fields
    FROM jsonb_array_elements(v_batch) AS item
    WHERE NULLIF(item->>'filename', '') IS NOT NULL
    ORDER BY item->>'filename'
  ),
  -- Jeden průchod tabulkou, ne poddotaz na řádek. První verze se u každého
  -- příchozího dokladu ptala `SELECT count(*) … WHERE filename = …`, což je při
  -- dávce 4 050 dokladů proti 63 830 řádkům 4 050 sekvenčních průchodů —
  -- naměřeno na produkci 2026-07-31 jako `Query read timeout` (li-driver bundle
  -- fail-closed odmítl a držel kurzor). Agregace předem + join dělá totéž na
  -- jedno projití; `idx_li_source_registry_filename` je k tomu ten index.
  -- DISTINCT ON, ne agregace: `min()` pro uuid v Postgresu neexistuje a řádek
  -- stejně bereme jen tehdy, když je JEDINÝ (počet z window funkce vedle).
  existing AS (
    SELECT DISTINCT ON (r.filename)
           r.filename,
           r.id,
           r.source_sha256 AS sha,
           r.fields,
           count(*) OVER (PARTITION BY r.filename) AS n
    FROM public.li_source_registry r
    JOIN incoming i ON i.filename = r.filename
    ORDER BY r.filename, r.id
  ),
  kandidati AS (
    SELECT e.id, i.sha,
           -- TÁŽ podmínka jako brána u ON CONFLICT níže (jediný zdroj pravdy:
           -- li_usable_field_count; poměr ½ viz komentář u brány)
           (public.li_usable_field_count(e.fields) > 0
            AND public.li_usable_field_count(i.fields) * 2
                < public.li_usable_field_count(e.fields)) AS horsi
    FROM incoming i
    JOIN existing e ON e.filename = i.filename
    WHERE e.n = 1                 -- právě jeden řádek toho jména (jinak nehádat)
      AND e.sha <> i.sha          -- obsah se opravdu změnil (replay nic nepřeklíčuje)
      AND NOT EXISTS (SELECT 1 FROM public.li_source_registry r3
                       WHERE r3.source_sha256 = i.sha)  -- cílový hash je volný
  ),
  prekliceno AS (
    UPDATE public.li_source_registry t
       SET source_sha256 = k.sha
      FROM kandidati k
     WHERE t.id = k.id
       AND NOT k.horsi
    RETURNING 1
  )
  SELECT (SELECT count(*) FROM prekliceno)::integer,
         COALESCE((SELECT array_agg(k.sha) FROM kandidati k WHERE k.horsi), '{}')
    INTO v_rekeyed, v_odmitnute;
  v_odmitnuto := cardinality(v_odmitnute);

  -- Počítá se AŽ po rekeyi: překlíčované řádky jsou update, ne insert. Jinak by
  -- audit hlásil vložení tam, kde se doklad jen aktualizoval.
  SELECT count(*) INTO v_updated
  FROM public.li_source_registry r
  WHERE r.source_sha256 IN (
    SELECT item->>'source_sha256'
    FROM jsonb_array_elements(v_batch) AS item
  );

  INSERT INTO public.li_source_registry (
    source_sha256, doc_slug, story_id, doc_type, doc_class, filename, status,
    missing_required, fields, fields_pending_review, line_items,
    lines_pending_review, schema_version, superseded_by,
    export_id, engine_version, verify_ok, raw_data, storage_bucket,
    ingested_at, updated_at
  )
  SELECT
    item->>'source_sha256',
    item->>'source_slug',
    NULLIF(item->>'story_id', '')::uuid,
    item->>'doc_type',
    item->>'doc_class',
    item->>'filename',
    COALESCE(item->>'status', 'REVIEW'),
    COALESCE(
      ARRAY(SELECT jsonb_array_elements_text(item->'missing_required')),
      '{}'::text[]
    ),
    COALESCE(item->'fields', '{}'::jsonb),
    COALESCE(item->'fields_pending_review', '{}'::jsonb),
    COALESCE(item->'line_items', '[]'::jsonb),
    COALESCE((item->>'lines_pending_review')::integer, 0),
    item->>'schema_version',
    item->>'superseded_by',
    p_export_id,
    p_engine_version,
    p_verify_ok,
    item,
    -- Umístění binárky je DATA řádku: píše ho ingest, který ví, kam objekt
    -- uložil (žádná konstanta v kódu; klíč objektu = <sha256>.pdf).
    NULLIF(item->>'storage_bucket', ''),
    now(),
    now()
  FROM jsonb_array_elements(v_batch) AS item
  -- verze odmítnuté už při rekeyi se nevkládají (viz REKEY NESMÍ PŘEDBĚHNOUT BRÁNU)
  WHERE NOT (item->>'source_sha256' = ANY (v_odmitnute))
  ON CONFLICT (source_sha256) DO UPDATE SET
    doc_slug             = EXCLUDED.doc_slug,
    story_id             = EXCLUDED.story_id,
    doc_type             = EXCLUDED.doc_type,
    doc_class            = EXCLUDED.doc_class,
    filename             = EXCLUDED.filename,
    status               = EXCLUDED.status,
    missing_required     = EXCLUDED.missing_required,
    fields               = EXCLUDED.fields,
    fields_pending_review = EXCLUDED.fields_pending_review,
    line_items           = EXCLUDED.line_items,
    lines_pending_review = EXCLUDED.lines_pending_review,
    schema_version       = EXCLUDED.schema_version,
    superseded_by        = EXCLUDED.superseded_by,
    export_id            = EXCLUDED.export_id,
    engine_version       = EXCLUDED.engine_version,
    verify_ok            = EXCLUDED.verify_ok,
    raw_data             = EXCLUDED.raw_data,
    -- replay bez bucketu nesmí smazat známé umístění binárky
    storage_bucket       = COALESCE(EXCLUDED.storage_bucket, li_source_registry.storage_bucket),
    ingested_at          = EXCLUDED.ingested_at,
    updated_at           = now()
  -- ── MONOTONICITA: pozdější balík nesmí být HORŠÍ ──────────────────────────
  -- Upsert je idempotentní, ale do 2026-08-01 nebyl monotónní: „pozdější
  -- vždycky vyhraje". Naměřeno 2026-07-30 na produkci — balík z neverzovaného
  -- lokálního běhu (engine 'local', schema null) přepsal smlouvy a shodil
  -- 11 z 20 polí (counterparty 29→9, supplier_name 45→11). Registr od té doby
  -- nesl poslední, co někdo shodil, ne nejlepší, co jsme kdy naměřili.
  --
  -- Řádek se proto NEPŘEPÍŠE, když příchozí vytěžení nemá ani polovinu
  -- použitelných polí existujícího — celý řádek zůstává, včetně provenience,
  -- která tak dál ukazuje na balík, jenž obsah skutečně vyrobil. Poměr ½ je
  -- záměrně hrubý: legitimní oprava jednotek polí projde, propad na pětinu ne.
  -- Plánovaný hromadný re-ingest nad kompletními vstupy vytěží VÍC polí, takže
  -- touhle branou projde přirozeně — brána chrání před regresí, ne před opravou.
  -- Odmítnuté řádky počítá v_kept_better (viz audit) a li-driver je hlásí WARN.
  WHERE NOT (
    public.li_usable_field_count(li_source_registry.fields) > 0
    AND public.li_usable_field_count(EXCLUDED.fields) * 2
        < public.li_usable_field_count(li_source_registry.fields)
  );

  -- ROW_COUNT u INSERT … ON CONFLICT nepočítá řádky, které DO UPDATE WHERE
  -- odmítl — rozdíl proti dávce je tedy přesně počet ochráněných řádků.
  GET DIAGNOSTICS v_written = ROW_COUNT;
  -- kept_better = odmítnuté branou u ON CONFLICT + odmítnuté už při rekeyi
  -- (ty se nevložily, v_written je nezná).
  v_kept_better := v_total - v_written;
  -- Odmítnuté při rekeyi nejsou ani vložené, ani mezi existujícími (jejich sha
  -- v tabulce není) — odečtou se zvlášť, jinak by audit hlásil vložení.
  v_inserted := v_total - v_updated - v_odmitnuto;
  -- 'updated' odteď znamená SKUTEČNĚ přepsané (dřív: kolik řádků existovalo).
  v_updated := v_updated - (v_kept_better - v_odmitnuto);

  INSERT INTO public.audit_journal (user_id, action, metadata)
  VALUES (
    auth.uid(),
    'li_source_registry.upsert_completed',
    jsonb_build_object(
      'export_id', p_export_id,
      'engine_version', p_engine_version,
      'verify_ok', p_verify_ok,
      'total', v_total,
      'inserted', v_inserted,
      'updated', v_updated,
      -- Kolik dokladů se překlíčovalo na nový obsah (refresh téhož dokladu).
      -- Patří do auditu: bez toho by „updated" nešlo odlišit od replaye beze změny.
      'rekeyed', v_rekeyed,
      -- Kolik řádků brána monotonicity ochránila před horším vytěžením.
      'kept_better', v_kept_better
    )
  );

  RETURN jsonb_build_object(
    'total', v_total,
    'inserted', v_inserted,
    'updated', v_updated,
    'rekeyed', v_rekeyed,
    'kept_better', v_kept_better
  );
END;
$$;

REVOKE ALL ON FUNCTION public.li_upsert_source_registry(jsonb, text, text, boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.li_upsert_source_registry(jsonb, text, text, boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.li_upsert_source_registry(jsonb, text, text, boolean) TO service_role;
