-- ============================================================================
-- Source of Truth: li_upsert_links
-- Popis: Batch upsert doložených vazeb mezi doklady z local-ingest. Volá
--        svc-source-broker li-driver z links_artifact.jsonl. link_key (dedup)
--        počítá RPC z rule_id + from_sha + to_sha + relation. relation=supersedes
--        je zdroj projekce „platná verze" — driver mapper, klíč server-side.
-- Bezpečnost: SECURITY DEFINER + REVOKE/GRANT; service_role / admin / staff.
-- Audit: li_links.upsert_completed s počty (bez PII).
-- ============================================================================

CREATE OR REPLACE FUNCTION public.li_upsert_links(
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

  -- link_key = md5(rule_id | from_sha | to_sha | relation).
  SELECT COALESCE(jsonb_agg(
    item || jsonb_build_object('_link_key', md5(
      COALESCE(item->>'rule_id', '') || '|' ||
      COALESCE(item->'from'->>'source_sha256', '') || '|' ||
      COALESCE(item->'to'->>'source_sha256', '') || '|' ||
      COALESCE(item->>'relation', '')
    ))
  ), '[]'::jsonb) INTO v_keyed
  FROM jsonb_array_elements(p_rows) AS item
  WHERE item->'from'->>'source_sha256' IS NOT NULL
    AND item->'to'->>'source_sha256' IS NOT NULL;

  SELECT COALESCE(jsonb_agg(deduped.item), '[]'::jsonb) INTO v_batch
  FROM (
    SELECT DISTINCT ON (item->>'_link_key') item
    FROM jsonb_array_elements(v_keyed) AS item
  ) AS deduped;

  v_total := jsonb_array_length(v_batch);

  SELECT count(*) INTO v_updated
  FROM public.li_links l
  WHERE l.link_key IN (
    SELECT item->>'_link_key'
    FROM jsonb_array_elements(v_batch) AS item
  );

  -- rule_key ← export wire-pole 'rule_id' (TEXT slug pravidla, NE uuid FK).
  INSERT INTO public.li_links (
    link_key, rule_key, relation,
    from_sha256, from_slug, from_doc_type,
    to_sha256, to_slug, to_doc_type, matched_by,
    export_id, engine_version, verify_ok, raw_data, ingested_at, updated_at
  )
  SELECT
    item->>'_link_key',
    item->>'rule_id',
    item->>'relation',
    item->'from'->>'source_sha256',
    item->'from'->>'source_slug',
    item->'from'->>'doc_type',
    item->'to'->>'source_sha256',
    item->'to'->>'source_slug',
    item->'to'->>'doc_type',
    COALESCE(item->'matched_by', '[]'::jsonb),
    p_export_id,
    p_engine_version,
    p_verify_ok,
    item - '_link_key',
    now(),
    now()
  FROM jsonb_array_elements(v_batch) AS item
  ON CONFLICT (link_key) DO UPDATE SET
    rule_key       = EXCLUDED.rule_key,
    relation       = EXCLUDED.relation,
    from_sha256    = EXCLUDED.from_sha256,
    from_slug      = EXCLUDED.from_slug,
    from_doc_type  = EXCLUDED.from_doc_type,
    to_sha256      = EXCLUDED.to_sha256,
    to_slug        = EXCLUDED.to_slug,
    to_doc_type    = EXCLUDED.to_doc_type,
    matched_by     = EXCLUDED.matched_by,
    export_id      = EXCLUDED.export_id,
    engine_version = EXCLUDED.engine_version,
    verify_ok      = EXCLUDED.verify_ok,
    raw_data       = EXCLUDED.raw_data,
    ingested_at    = EXCLUDED.ingested_at,
    updated_at     = now();

  v_inserted := v_total - v_updated;

  INSERT INTO public.audit_journal (user_id, action, metadata)
  VALUES (
    auth.uid(),
    'li_links.upsert_completed',
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

REVOKE ALL ON FUNCTION public.li_upsert_links(jsonb, text, text, boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.li_upsert_links(jsonb, text, text, boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.li_upsert_links(jsonb, text, text, boolean) TO service_role;
