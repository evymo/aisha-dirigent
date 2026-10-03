-- ============================================================================
-- Source of Truth: li_upsert_entity_suggestions
-- Popis: Batch upsert advisory návrhů sjednocení entit z local-ingest. Volá
--        svc-source-broker li-driver z entity_suggestions_artifact.jsonl.
--        suggestion_key (dedup) počítá RPC. advisory zůstává vždy true (tabulka
--        má CHECK) — z těchto řádků se NIKDY negeneruje FK/vazba.
-- Bezpečnost: SECURITY DEFINER + REVOKE/GRANT; service_role / admin / staff.
-- Audit: li_entity_suggestions.upsert_completed s počty (bez PII).
-- ============================================================================

CREATE OR REPLACE FUNCTION public.li_upsert_entity_suggestions(
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
  v_is_service boolean := public.is_service_role();
  v_keyed      jsonb;
  v_batch      jsonb;
  v_total      integer;
  v_updated    integer;
  v_inserted   integer;
BEGIN
  IF NOT v_is_service AND NOT public.is_admin_or_staff() THEN
    RAISE EXCEPTION 'Unauthorized: admin, staff, or service_role required';
  END IF;

  IF p_rows IS NULL OR jsonb_typeof(p_rows) <> 'array' THEN
    RAISE EXCEPTION 'p_rows must be a jsonb array';
  END IF;

  -- suggestion_key = md5(suggestion | pole | hodnota) — DETERMINISTICKY ROZLIŠUJÍCÍ.
  --
  -- ⛔ DEGENEROVANÝ KLÍČ SLEPÍ CELOU DÁVKU DO JEDNOHO ŘÁDKU (naměřeno 2026-07-31).
  -- Původní klíč znal jen tvar `same_*` (`id_field`/`name_field` + `id_value`/
  -- `name_normalized`). Novější `similar_values_may_merge` nese místo nich
  -- `field` + `values` + `question_id`, takže mu VŠECHNY tři složky vyšly prázdné
  -- a 659 různých návrhů dostalo týž klíč `md5('similar_values_may_merge||')`.
  -- `DISTINCT ON` níž z nich udělal JEDEN. Totéž `merge_scan_truncated` (2 → 1).
  -- Z 672 návrhů se uložilo 13 a nikde nevznikla chyba: dedup je legitimní
  -- operace, takže ztráta vypadá jako úspěch (`msg: "bundle ingested"`).
  -- Cena: 197 z těch 659 bylo sloučení jmen řidičů (`KOŽUŠNÍK`×`Kožušník`,
  -- `MATYAŠ`×`Matyáš`), takže produkce drží 1 476 twinů `driver` — jeden na každý
  -- pravopis místo jednoho na člověka.
  --
  -- `question_id` je stabilní identifikátor návrhu z ingestu (ověřeno: unikátní
  -- pro všech 659); `values` je záloha, kdyby ho starší artefakt neměl. Pořadí
  -- COALESCE drží zpětnou kompatibilitu — pro tvar `same_*` vyjde TÝŽ klíč jako
  -- dřív, takže se existující řádky aktualizují a nezaloží se duplikáty.
  SELECT COALESCE(jsonb_agg(
    item || jsonb_build_object('_suggestion_key', md5(
      COALESCE(item->>'suggestion', '') || '|' ||
      COALESCE(item->>'id_field', item->>'name_field', item->>'field', '') || '|' ||
      COALESCE(item->>'id_value', item->>'name_normalized',
               item->>'question_id', item->>'values', '')
    ))
  ), '[]'::jsonb) INTO v_keyed
  FROM jsonb_array_elements(p_rows) AS item
  WHERE item->>'suggestion' IS NOT NULL;

  SELECT COALESCE(jsonb_agg(deduped.item), '[]'::jsonb) INTO v_batch
  FROM (
    SELECT DISTINCT ON (item->>'_suggestion_key') item
    FROM jsonb_array_elements(v_keyed) AS item
  ) AS deduped;

  v_total := jsonb_array_length(v_batch);

  SELECT count(*) INTO v_updated
  FROM public.li_entity_suggestions e
  WHERE e.suggestion_key IN (
    SELECT item->>'_suggestion_key'
    FROM jsonb_array_elements(v_batch) AS item
  );

  INSERT INTO public.li_entity_suggestions (
    suggestion_key, suggestion, id_field, id_value, name_field, name_normalized,
    names, ids, documents, advisory,
    export_id, engine_version, verify_ok, raw_data, ingested_at, updated_at
  )
  SELECT
    item->>'_suggestion_key',
    item->>'suggestion',
    item->>'id_field',
    item->>'id_value',
    item->>'name_field',
    item->>'name_normalized',
    COALESCE(ARRAY(SELECT jsonb_array_elements_text(item->'names')), '{}'::text[]),
    COALESCE(ARRAY(SELECT jsonb_array_elements_text(item->'ids')), '{}'::text[]),
    COALESCE(ARRAY(SELECT jsonb_array_elements_text(item->'documents')), '{}'::text[]),
    true,  -- doktrína: advisory návrh, nikdy automatická vazba (tabulka má CHECK)
    p_export_id,
    p_engine_version,
    p_verify_ok,
    item - '_suggestion_key',
    now(),
    now()
  FROM jsonb_array_elements(v_batch) AS item
  ON CONFLICT (suggestion_key) DO UPDATE SET
    suggestion      = EXCLUDED.suggestion,
    id_field        = EXCLUDED.id_field,
    id_value        = EXCLUDED.id_value,
    name_field      = EXCLUDED.name_field,
    name_normalized = EXCLUDED.name_normalized,
    names           = EXCLUDED.names,
    ids             = EXCLUDED.ids,
    documents       = EXCLUDED.documents,
    export_id       = EXCLUDED.export_id,
    engine_version  = EXCLUDED.engine_version,
    verify_ok       = EXCLUDED.verify_ok,
    raw_data        = EXCLUDED.raw_data,
    ingested_at     = EXCLUDED.ingested_at,
    updated_at      = now();

  v_inserted := v_total - v_updated;

  INSERT INTO public.audit_journal (user_id, action, metadata)
  VALUES (
    auth.uid(),
    'li_entity_suggestions.upsert_completed',
    jsonb_build_object(
      'export_id', p_export_id,
      'engine_version', p_engine_version,
      'verify_ok', p_verify_ok,
      'total', v_total,
      'inserted', v_inserted,
      'updated', v_updated
    )
  );

  RETURN jsonb_build_object(
    'total', v_total,
    'inserted', v_inserted,
    'updated', v_updated
  );
END;
$$;

REVOKE ALL ON FUNCTION public.li_upsert_entity_suggestions(jsonb, text, text, boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.li_upsert_entity_suggestions(jsonb, text, text, boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.li_upsert_entity_suggestions(jsonb, text, text, boolean) TO service_role;
