-- ============================================================================
-- Source of Truth: li_upsert_findings
-- Popis: Batch upsert deterministických nálezů z local-ingest. Volá
--        svc-source-broker li-driver z findings_artifact.jsonl. finding_key
--        (dedup) počítá RPC z rule_id + finding + seřazených sha dotčených
--        dokladů — driver zůstává tenký mapper, idempotence je server-side.
-- Bezpečnost: SECURITY DEFINER + REVOKE/GRANT; service_role / admin / staff.
-- Audit: li_findings.upsert_completed s počty (bez PII).
-- ============================================================================

CREATE OR REPLACE FUNCTION public.li_upsert_findings(
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

  -- finding_key = md5(rule_id | finding | seřazené sha dokladů). Seřazení sha
  -- činí klíč nezávislý na pořadí dokumentů v poli (stabilní napříč exporty).
  SELECT COALESCE(jsonb_agg(
    item || jsonb_build_object('_finding_key', md5(
      COALESCE(item->>'rule_id', '') || '|' ||
      COALESCE(item->>'finding', '') || '|' ||
      COALESCE((
        SELECT string_agg(doc->>'source_sha256', ',' ORDER BY doc->>'source_sha256')
        FROM jsonb_array_elements(COALESCE(item->'documents', '[]'::jsonb)) AS doc
        WHERE doc->>'source_sha256' IS NOT NULL
      ), '')
    ))
  ), '[]'::jsonb) INTO v_keyed
  FROM jsonb_array_elements(p_rows) AS item
  WHERE item->>'finding' IS NOT NULL;

  -- Dedup v dávce podle vypočteného klíče (poslední výskyt vyhrává).
  SELECT COALESCE(jsonb_agg(deduped.item), '[]'::jsonb) INTO v_batch
  FROM (
    SELECT DISTINCT ON (item->>'_finding_key') item
    FROM jsonb_array_elements(v_keyed) AS item
  ) AS deduped;

  v_total := jsonb_array_length(v_batch);

  SELECT count(*) INTO v_updated
  FROM public.li_findings f
  WHERE f.finding_key IN (
    SELECT item->>'_finding_key'
    FROM jsonb_array_elements(v_batch) AS item
  );

  -- rule_key ← export wire-pole 'rule_id' (local-ingest slug pravidla, např.
  -- 'price_mismatch'; TEXT klíč, NE uuid FK na expert_rules). Sloupec se jmenuje
  -- rule_key právě proto, aby název nesliboval FK, kterým není.
  INSERT INTO public.li_findings (
    finding_key, rule_key, finding, severity, documents, evidence,
    export_id, engine_version, verify_ok, raw_data, ingested_at, updated_at
  )
  SELECT
    item->>'_finding_key',
    item->>'rule_id',
    item->>'finding',
    item->>'severity',
    COALESCE(item->'documents', '[]'::jsonb),
    item->'evidence',
    p_export_id,
    p_engine_version,
    p_verify_ok,
    item - '_finding_key',
    now(),
    now()
  FROM jsonb_array_elements(v_batch) AS item
  ON CONFLICT (finding_key) DO UPDATE SET
    rule_key       = EXCLUDED.rule_key,
    finding        = EXCLUDED.finding,
    severity       = EXCLUDED.severity,
    documents      = EXCLUDED.documents,
    evidence       = EXCLUDED.evidence,
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
    'li_findings.upsert_completed',
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

REVOKE ALL ON FUNCTION public.li_upsert_findings(jsonb, text, text, boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.li_upsert_findings(jsonb, text, text, boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.li_upsert_findings(jsonb, text, text, boolean) TO service_role;
