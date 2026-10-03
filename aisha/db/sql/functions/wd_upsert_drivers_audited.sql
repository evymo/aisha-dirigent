-- ============================================================================
-- Source of Truth: wd_upsert_drivers_audited
-- Popis: Batch upsert řidičů z Webdispečinku. Volá svc-webdispecink po
--        stažení _getDriversList2. Řidiči se nikdy nemažou — deaktivace
--        přijde z API přes pole active. Ruční mapování erp_employee_ref
--        se importem nepřepisuje. Vrací počty inserted/updated.
-- Bezpečnost: SECURITY DEFINER + REVOKE/GRANT
-- Audit: wd_drivers.import_completed s počty (bez PII)
-- ============================================================================

CREATE OR REPLACE FUNCTION public.wd_upsert_drivers_audited(
  p_drivers jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  -- Canonical boolean-NOT-NULL service check (is_service_role.sql, #588): the
  -- prior inline claims idiom folds to SQL NULL without a role claim and the
  -- negative deny-guard below then fails OPEN. is_service_role() COALESCEs to
  -- false, so the guard is total (fails CLOSED).
  v_is_service boolean := public.is_service_role();
  v_batch jsonb;
  v_total integer;
  v_updated integer;
  v_inserted integer;
BEGIN
  -- Authorization check (FIRST, before any data access)
  IF NOT v_is_service AND NOT public.is_admin_or_staff() THEN
    RAISE EXCEPTION 'Unauthorized: admin, staff, or service_role required';
  END IF;

  -- Input validation
  IF p_drivers IS NULL OR jsonb_typeof(p_drivers) <> 'array' THEN
    RAISE EXCEPTION 'p_drivers must be a jsonb array';
  END IF;

  -- Dedup podle wd_driver_id — ON CONFLICT nesmí zasáhnout stejný řádek dvakrát
  SELECT COALESCE(jsonb_agg(deduped.item), '[]'::jsonb) INTO v_batch
  FROM (
    SELECT DISTINCT ON ((item->>'wd_driver_id')::integer) item
    FROM jsonb_array_elements(p_drivers) AS item
    WHERE item->>'wd_driver_id' IS NOT NULL
  ) AS deduped;

  v_total := jsonb_array_length(v_batch);

  SELECT count(*) INTO v_updated
  FROM public.wd_drivers d
  WHERE d.wd_driver_id IN (
    SELECT (item->>'wd_driver_id')::integer
    FROM jsonb_array_elements(v_batch) AS item
  );

  INSERT INTO public.wd_drivers (
    wd_driver_id, first_name, last_name, personal_number,
    group_id, group_name, card_identifier, phone, active,
    assigned_vehicle, raw_data, last_import_at, updated_at
  )
  SELECT
    (item->>'wd_driver_id')::integer,
    item->>'first_name',
    item->>'last_name',
    item->>'personal_number',
    (item->>'group_id')::integer,
    item->>'group_name',
    item->>'card_identifier',
    item->>'phone',
    COALESCE((item->>'active')::boolean, true),
    item->>'assigned_vehicle',
    item->'raw',
    now(),
    now()
  FROM jsonb_array_elements(v_batch) AS item
  ON CONFLICT (wd_driver_id) DO UPDATE SET
    first_name       = EXCLUDED.first_name,
    last_name        = EXCLUDED.last_name,
    personal_number  = EXCLUDED.personal_number,
    group_id         = EXCLUDED.group_id,
    group_name       = EXCLUDED.group_name,
    card_identifier  = EXCLUDED.card_identifier,
    phone            = EXCLUDED.phone,
    active           = EXCLUDED.active,
    assigned_vehicle = EXCLUDED.assigned_vehicle,
    raw_data         = EXCLUDED.raw_data,
    last_import_at   = EXCLUDED.last_import_at,
    updated_at       = now();

  v_inserted := v_total - v_updated;

  -- Audit log (jen počty — jména a osobní čísla do auditu nepatří)
  INSERT INTO public.audit_journal (user_id, action, metadata)
  VALUES (
    auth.uid(),
    'wd_drivers.import_completed',
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

REVOKE ALL ON FUNCTION public.wd_upsert_drivers_audited(jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.wd_upsert_drivers_audited(jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.wd_upsert_drivers_audited(jsonb) TO service_role;
