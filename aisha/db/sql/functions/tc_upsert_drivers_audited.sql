-- ============================================================================
-- Source of Truth: tc_upsert_drivers_audited
-- Popis: Batch upsert řidičů/osob z T-cars (osobySeznam). Volá svc-tcars.
--        erp_employee_ref import nepřepisuje (ruční mapování).
-- Bezpečnost: SECURITY DEFINER + REVOKE/GRANT
-- Audit: tc_drivers.import_completed s počty (bez PII)
-- ============================================================================

CREATE OR REPLACE FUNCTION public.tc_upsert_drivers_audited(
  p_drivers jsonb
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
BEGIN
  IF NOT v_is_service AND NOT public.is_admin_or_staff() THEN
    RAISE EXCEPTION 'Unauthorized: admin, staff, or service_role required';
  END IF;

  IF p_drivers IS NULL OR jsonb_typeof(p_drivers) <> 'array' THEN
    RAISE EXCEPTION 'p_drivers must be a jsonb array';
  END IF;

  SELECT COALESCE(jsonb_agg(deduped.item), '[]'::jsonb) INTO v_batch
  FROM (
    SELECT DISTINCT ON ((item->>'tc_driver_id')::integer) item
    FROM jsonb_array_elements(p_drivers) AS item
    WHERE item->>'tc_driver_id' IS NOT NULL
  ) AS deduped;

  v_total := jsonb_array_length(v_batch);

  SELECT count(*) INTO v_updated
  FROM public.tc_drivers d
  WHERE d.tc_driver_id IN (
    SELECT (item->>'tc_driver_id')::integer
    FROM jsonb_array_elements(v_batch) AS item
  );

  INSERT INTO public.tc_drivers (
    tc_driver_id, name, personal_number, phone, mobile, email,
    group_id, group_name, cost_center_id, position, active,
    raw_data, last_import_at, updated_at
  )
  SELECT
    (item->>'tc_driver_id')::integer,
    item->>'name',
    item->>'personal_number',
    item->>'phone',
    item->>'mobile',
    item->>'email',
    (item->>'group_id')::integer,
    item->>'group_name',
    (item->>'cost_center_id')::integer,
    item->>'position',
    COALESCE((item->>'active')::boolean, true),
    item->'raw',
    now(),
    now()
  FROM jsonb_array_elements(v_batch) AS item
  ON CONFLICT (tc_driver_id) DO UPDATE SET
    name             = EXCLUDED.name,
    personal_number  = EXCLUDED.personal_number,
    phone            = EXCLUDED.phone,
    mobile           = EXCLUDED.mobile,
    email            = EXCLUDED.email,
    group_id         = EXCLUDED.group_id,
    group_name       = EXCLUDED.group_name,
    cost_center_id   = EXCLUDED.cost_center_id,
    position         = EXCLUDED.position,
    active           = EXCLUDED.active,
    raw_data         = EXCLUDED.raw_data,
    last_import_at   = EXCLUDED.last_import_at,
    updated_at       = now();
    -- erp_employee_ref se ZÁMĚRNĚ neaktualizuje (ruční mapování).

  v_inserted := v_total - v_updated;

  INSERT INTO public.audit_journal (user_id, action, metadata)
  VALUES (
    auth.uid(),
    'tc_drivers.import_completed',
    jsonb_build_object('total', v_total, 'inserted', v_inserted, 'updated', v_updated)
  );

  RETURN jsonb_build_object('total', v_total, 'inserted', v_inserted, 'updated', v_updated);
END;
$$;

REVOKE ALL ON FUNCTION public.tc_upsert_drivers_audited(jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.tc_upsert_drivers_audited(jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.tc_upsert_drivers_audited(jsonb) TO service_role;
