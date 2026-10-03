-- ============================================================================
-- Source of Truth: li_upsert_obligations
-- Popis: Batch upsert registru závazků z local-ingest. Volá svc-source-broker
--        li-driver z obligations_artifact.jsonl. obligation_key (dedup) počítá
--        RPC z source_sha256 + span + rule_id. candidate_status z importu je
--        VŽDY NEEDS_REVIEW — driver nikdy nezvyšuje na HUMAN_CONFIRMED (jen
--        review flow); RPC proto candidate_status z payloadu ignoruje a vynutí
--        NEEDS_REVIEW, a existující řádky nezreví-downgraduje.
-- Bezpečnost: SECURITY DEFINER + REVOKE/GRANT; service_role / admin / staff.
-- Audit: li_obligations.upsert_completed s počty (bez PII).
-- ============================================================================

CREATE OR REPLACE FUNCTION public.li_upsert_obligations(
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

  -- obligation_key = md5(source_sha256 | char_start | char_end | rule_id).
  -- Span v dokladu je unikátní; klíč je stabilní napříč exporty téhož dokladu.
  SELECT COALESCE(jsonb_agg(
    item || jsonb_build_object('_obligation_key', md5(
      COALESCE(item->>'source_sha256', '') || '|' ||
      COALESCE(item->'span'->>'char_start', '') || '|' ||
      COALESCE(item->'span'->>'char_end', '') || '|' ||
      COALESCE(item->>'rule_id', '')
    ))
  ), '[]'::jsonb) INTO v_keyed
  FROM jsonb_array_elements(p_rows) AS item
  WHERE item->>'source_sha256' IS NOT NULL
    AND item->>'quote' IS NOT NULL;

  SELECT COALESCE(jsonb_agg(deduped.item), '[]'::jsonb) INTO v_batch
  FROM (
    SELECT DISTINCT ON (item->>'_obligation_key') item
    FROM jsonb_array_elements(v_keyed) AS item
  ) AS deduped;

  v_total := jsonb_array_length(v_batch);

  SELECT count(*) INTO v_updated
  FROM public.li_obligations o
  WHERE o.obligation_key IN (
    SELECT item->>'_obligation_key'
    FROM jsonb_array_elements(v_batch) AS item
  );

  -- rule_key ← export wire-pole 'rule_id' (TEXT slug pravidla, NE uuid FK).
  INSERT INTO public.li_obligations (
    obligation_key, source_sha256, doc_slug, filename, rule_key,
    clause_ref, clause_title, quote, char_start, char_end, page,
    obliged_party, action, deadline_text, consequence_text, candidate_status,
    export_id, engine_version, verify_ok, raw_data, ingested_at, updated_at
  )
  SELECT
    item->>'_obligation_key',
    item->>'source_sha256',
    item->>'source_slug',
    item->>'filename',
    item->>'rule_id',
    item->>'clause_ref',
    item->>'clause_title',
    item->>'quote',
    (item->'span'->>'char_start')::integer,
    (item->'span'->>'char_end')::integer,
    (item->'span'->>'page')::integer,
    item->>'obliged_party',
    item->>'action',
    item->>'deadline_text',
    item->>'consequence_text',
    'NEEDS_REVIEW',  -- vždy z importu; promoce jen přes review flow
    p_export_id,
    p_engine_version,
    p_verify_ok,
    item - '_obligation_key',
    now(),
    now()
  FROM jsonb_array_elements(v_batch) AS item
  ON CONFLICT (obligation_key) DO UPDATE SET
    source_sha256    = EXCLUDED.source_sha256,
    doc_slug         = EXCLUDED.doc_slug,
    filename         = EXCLUDED.filename,
    rule_key         = EXCLUDED.rule_key,
    clause_ref       = EXCLUDED.clause_ref,
    clause_title     = EXCLUDED.clause_title,
    quote            = EXCLUDED.quote,
    char_start       = EXCLUDED.char_start,
    char_end         = EXCLUDED.char_end,
    page             = EXCLUDED.page,
    obliged_party    = EXCLUDED.obliged_party,
    action           = EXCLUDED.action,
    deadline_text    = EXCLUDED.deadline_text,
    consequence_text = EXCLUDED.consequence_text,
    -- candidate_status se přes replay NIKDY nesnižuje: HUMAN_CONFIRMED z review
    -- flow přetrvá, i když re-export nese NEEDS_REVIEW (advisory ≠ pravda).
    export_id        = EXCLUDED.export_id,
    engine_version   = EXCLUDED.engine_version,
    verify_ok        = EXCLUDED.verify_ok,
    raw_data         = EXCLUDED.raw_data,
    ingested_at      = EXCLUDED.ingested_at,
    updated_at       = now();

  v_inserted := v_total - v_updated;

  INSERT INTO public.audit_journal (user_id, action, metadata)
  VALUES (
    auth.uid(),
    'li_obligations.upsert_completed',
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

REVOKE ALL ON FUNCTION public.li_upsert_obligations(jsonb, text, text, boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.li_upsert_obligations(jsonb, text, text, boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.li_upsert_obligations(jsonb, text, text, boolean) TO service_role;
