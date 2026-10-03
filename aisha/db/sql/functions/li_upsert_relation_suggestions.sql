-- Function: public.li_upsert_relation_suggestions
-- Konzument entity_relation_artifact.jsonl + relation_proposal_artifact.jsonl.
--
-- Proč vzniká: engine oba artefakty VYRÁBĚL a driver je NEČETL. Naměřeno
-- 2026-08-30 na produkci — 345 odvozených vztahů, a přitom `graph_nodes` i
-- `graph_edges` měly nula řádků. Síť vazeb se odvodila a zahodila u dveří.
--
-- Dva různé tvary, jedna tabulka (druh je vlastnost, ne výčet):
--   `entity_relation`    — JEDEN parametr sdílený víc entitami: parameter+value,
--                          nese `entities_reached` (kolik identit provází).
--   `relation_proposal`  — DVOJICE parametrů: parameter_a+parameter_b+direction,
--                          nese míry funkční závislosti a lift.
-- Co se nefiltruje, jde celé do `raw_data` — sloupce jsou jen to, na co se ptáme.
--
-- Zůstává NÁVRHEM: engine oba druhy razítkuje `advisory: True` („doložený vztah,
-- nikdy automatická vazba"), tabulka to drží CHECKem. Vazbu otevře až ratifikace.
--
-- Security: SECURITY DEFINER. Admin/staff nebo service_role.
-- @audit: required

CREATE OR REPLACE FUNCTION public.li_upsert_relation_suggestions(
  p_rows              jsonb,
  p_export_id         text    DEFAULT NULL,
  p_engine_version    text    DEFAULT NULL,
  p_verify_ok         boolean DEFAULT false,
  p_ingest_source_slug text   DEFAULT 'local-ingest'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_keyed    jsonb;
  v_batch    jsonb;
  v_total    integer;
  v_updated  integer;
  v_inserted integer;
BEGIN
  IF NOT public.is_service_role() AND NOT public.is_admin_or_staff() THEN
    RAISE EXCEPTION 'Unauthorized: admin, staff, or service_role required';
  END IF;

  IF p_rows IS NULL OR jsonb_typeof(p_rows) <> 'array' THEN
    RAISE EXCEPTION 'p_rows must be a jsonb array';
  END IF;

  -- Klíč nese OBĚ strany i hodnotu: tentýž parametr sdílený jinou hodnotou je
  -- jiný vztah. Kdyby se klíčovalo jen parametrem, druhý běh by první přepsal.
  SELECT COALESCE(jsonb_agg(
    item || jsonb_build_object('_suggestion_key', md5(
      COALESCE(item->>'record_type', '') || '|' ||
      COALESCE(item->>'kind', '') || '|' ||
      COALESCE(item->>'parameter_a', item->>'parameter', '') || '|' ||
      COALESCE(item->>'parameter_b', '') || '|' ||
      COALESCE(item->>'value', '')
    ))
  ), '[]'::jsonb) INTO v_keyed
  FROM jsonb_array_elements(p_rows) AS item
  WHERE item->>'record_type' IS NOT NULL
    AND COALESCE(item->>'parameter_a', item->>'parameter') IS NOT NULL;

  SELECT COALESCE(jsonb_agg(deduped.item), '[]'::jsonb) INTO v_batch
  FROM (
    SELECT DISTINCT ON (item->>'_suggestion_key') item
    FROM jsonb_array_elements(v_keyed) AS item
  ) AS deduped;

  v_total := jsonb_array_length(v_batch);

  SELECT count(*) INTO v_updated
  FROM public.li_relation_suggestions e
  WHERE e.suggestion_key IN (
    SELECT item->>'_suggestion_key' FROM jsonb_array_elements(v_batch) AS item
  );

  INSERT INTO public.li_relation_suggestions (
    suggestion_key, record_type, relation_kind, parameter_a, parameter_b, value,
    direction, observations, entities_reached, observed_from, observed_to, time_axis, advisory,
    ingest_source_slug, export_id, engine_version, verify_ok, raw_data,
    ingested_at, updated_at
  )
  SELECT
    item->>'_suggestion_key',
    item->>'record_type',
    item->>'kind',
    COALESCE(item->>'parameter_a', item->>'parameter'),
    item->>'parameter_b',
    item->>'value',
    item->>'direction',
    COALESCE((item->>'observations')::integer, 0),
    (item->>'entities_reached')::integer,
    -- Perioda je POLE ['od','do']; `entity_relation` ji nenese, proto NULL.
    -- Bez `time_axis` se období nedá interpretovat, tak jde ven s ním.
    (item->'period'->>0)::date,
    (item->'period'->>1)::date,
    item->>'time_axis',
    true,  -- doktrína: advisory návrh, nikdy automatická vazba (tabulka má CHECK)
    p_ingest_source_slug,
    p_export_id,
    p_engine_version,
    p_verify_ok,
    item - '_suggestion_key',
    now(),
    now()
  FROM jsonb_array_elements(v_batch) AS item
  ON CONFLICT (suggestion_key) DO UPDATE SET
    record_type      = EXCLUDED.record_type,
    relation_kind    = EXCLUDED.relation_kind,
    parameter_a      = EXCLUDED.parameter_a,
    parameter_b      = EXCLUDED.parameter_b,
    value            = EXCLUDED.value,
    direction        = EXCLUDED.direction,
    observations     = EXCLUDED.observations,
    entities_reached = EXCLUDED.entities_reached,
    observed_from    = EXCLUDED.observed_from,
    observed_to      = EXCLUDED.observed_to,
    time_axis        = EXCLUDED.time_axis,
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
    'li_relation_suggestions.upsert_completed',
    jsonb_build_object(
      'export_id', p_export_id,
      'engine_version', p_engine_version,
      'verify_ok', p_verify_ok,
      'ingest_source_slug', p_ingest_source_slug,
      'total', v_total,
      'inserted', v_inserted,
      'updated', v_updated
    )
  );

  RETURN jsonb_build_object('total', v_total, 'inserted', v_inserted, 'updated', v_updated);
END;
$$;

REVOKE ALL ON FUNCTION public.li_upsert_relation_suggestions(jsonb, text, text, boolean, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.li_upsert_relation_suggestions(jsonb, text, text, boolean, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.li_upsert_relation_suggestions(jsonb, text, text, boolean, text) TO service_role;
