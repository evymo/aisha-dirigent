-- ============================================================================
-- Source of Truth: twin_upsert_parameter_definitions_audited
-- Popis: Seed most katalogu parametrů: JSON v gitu (instance data, formát
--        riq_parameter_definitions.v1 — camelCase entityType/dataType) →
--        twin_parameter_definitions (runtime). Přijímá v1 položky přímo
--        (camelCase i snake_case), upsert podle code — nové parametry se
--        přidávají DATY, žádná změna schématu.
-- Bezpečnost: SECURITY DEFINER + REVOKE/GRANT
-- Audit: twin_parameter_definitions.seed_completed s počty (bez PII)
-- ⛔ VLASTNICTVÍ KÓDU (2026-09-29): `code` je GLOBÁLNÍ klíč katalogu. Dřív
--    `ON CONFLICT (code) DO UPDATE` přepsal i `source`, typ a druh definice, kterou
--    deklaroval JINÝ zdroj — volající s právem na funkci (služba, plugin přes broker)
--    tak pod vlastním jménem převzal slovník cizího zdroje. Existující definici smí
--    aktualizovat jen týž zdroj; jinak 42501 s kódem a vlastníkem. Stráž je dvojí:
--    kontrola předem (čitelná chyba) a podmínka v DO UPDATE (atomicky i při souběhu).
-- ============================================================================

CREATE OR REPLACE FUNCTION public.twin_upsert_parameter_definitions_audited(
  p_definitions jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_is_service boolean := public.is_service_role();
  v_batch jsonb;
  v_total integer;
  v_updated integer;
  v_inserted integer;
  v_cizi_kod text;
  v_cizi_zdroj text;
BEGIN
  -- Authorization check (FIRST, before any data access)
  IF NOT v_is_service AND NOT public.is_admin_or_staff() THEN
    RAISE EXCEPTION 'Unauthorized: admin, staff, or service_role required';
  END IF;

  -- Input validation (camelCase = v1 formát, snake_case = tolerovaný alias)
  IF p_definitions IS NULL OR jsonb_typeof(p_definitions) <> 'array' THEN
    RAISE EXCEPTION 'p_definitions must be a jsonb array';
  END IF;
  IF EXISTS (
    SELECT 1 FROM jsonb_array_elements(p_definitions) AS item
    WHERE COALESCE(item->>'code', '') = ''
       OR COALESCE(item->>'name', '') = ''
       OR COALESCE(item->>'entityType', item->>'entity_type', '') = ''
       OR COALESCE(item->>'dataType', item->>'data_type', '') = ''
  ) THEN
    RAISE EXCEPTION 'each definition requires code, name, entityType, dataType';
  END IF;

  -- Dedup podle code — ON CONFLICT nesmí zasáhnout stejný řádek dvakrát
  SELECT COALESCE(jsonb_agg(deduped.item), '[]'::jsonb) INTO v_batch
  FROM (
    SELECT DISTINCT ON (item->>'code') item
    FROM jsonb_array_elements(p_definitions) AS item
  ) AS deduped;

  v_total := jsonb_array_length(v_batch);

  -- Vlastnictví: existující kód jiného zdroje se nepřevezme (viz hlavička).
  SELECT d.code, d.source INTO v_cizi_kod, v_cizi_zdroj
    FROM public.twin_parameter_definitions d
    JOIN jsonb_array_elements(v_batch) AS item ON item->>'code' = d.code
   WHERE d.source IS DISTINCT FROM item->>'source'
   ORDER BY d.code
   LIMIT 1
   FOR UPDATE OF d;
  IF FOUND THEN
    RAISE EXCEPTION 'parameter definition % belongs to source %', v_cizi_kod, COALESCE(v_cizi_zdroj, '(none)')
      USING ERRCODE = '42501';
  END IF;

  SELECT count(*) INTO v_updated
  FROM public.twin_parameter_definitions d
  WHERE d.code IN (
    SELECT item->>'code' FROM jsonb_array_elements(v_batch) AS item
  );

  INSERT INTO public.twin_parameter_definitions (
    code, name, entity_type, data_type, unit, source, aggregation,
    historization, description, metadata, updated_at
  )
  SELECT
    item->>'code',
    item->>'name',
    COALESCE(item->>'entityType', item->>'entity_type'),
    COALESCE(item->>'dataType', item->>'data_type'),
    item->>'unit',
    item->>'source',
    item->>'aggregation',
    item->>'historization',
    item->>'description',
    COALESCE(item->'metadata', '{}'::jsonb),
    now()
  FROM jsonb_array_elements(v_batch) AS item
  ON CONFLICT (code) DO UPDATE SET
    name          = EXCLUDED.name,
    entity_type   = EXCLUDED.entity_type,
    data_type     = EXCLUDED.data_type,
    unit          = EXCLUDED.unit,
    source        = EXCLUDED.source,
    aggregation   = EXCLUDED.aggregation,
    historization = EXCLUDED.historization,
    description   = EXCLUDED.description,
    metadata      = EXCLUDED.metadata,
    updated_at    = now()
  WHERE public.twin_parameter_definitions.source IS NOT DISTINCT FROM EXCLUDED.source;

  v_inserted := v_total - v_updated;

  -- Audit log
  INSERT INTO public.audit_journal (user_id, action, metadata)
  VALUES (
    auth.uid(),
    'twin_parameter_definitions.seed_completed',
    jsonb_build_object(
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

REVOKE ALL ON FUNCTION public.twin_upsert_parameter_definitions_audited(jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.twin_upsert_parameter_definitions_audited(jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.twin_upsert_parameter_definitions_audited(jsonb) TO service_role;
