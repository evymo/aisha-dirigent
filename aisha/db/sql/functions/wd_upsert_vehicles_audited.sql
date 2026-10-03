-- ============================================================================
-- Source of Truth: wd_upsert_vehicles_audited
-- Popis: Batch upsert vozidel z Webdispečinku. Volá svc-webdispecink po
--        stažení _getCarsList2. Vozidla se nikdy nemažou — deaktivace přijde
--        z API přes pole active. Vrací počty inserted/updated.
-- Bezpečnost: SECURITY DEFINER + REVOKE/GRANT
-- Audit: wd_vehicles.import_completed s počty (bez PII)
-- ============================================================================

CREATE OR REPLACE FUNCTION public.wd_upsert_vehicles_audited(
  p_vehicles jsonb
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
  IF p_vehicles IS NULL OR jsonb_typeof(p_vehicles) <> 'array' THEN
    RAISE EXCEPTION 'p_vehicles must be a jsonb array';
  END IF;

  -- Dedup podle wd_car_id — ON CONFLICT nesmí zasáhnout stejný řádek dvakrát
  SELECT COALESCE(jsonb_agg(deduped.item), '[]'::jsonb) INTO v_batch
  FROM (
    SELECT DISTINCT ON ((item->>'wd_car_id')::integer) item
    FROM jsonb_array_elements(p_vehicles) AS item
    WHERE item->>'wd_car_id' IS NOT NULL
  ) AS deduped;

  v_total := jsonb_array_length(v_batch);

  SELECT count(*) INTO v_updated
  FROM public.wd_vehicles v
  WHERE v.wd_car_id IN (
    SELECT (item->>'wd_car_id')::integer
    FROM jsonb_array_elements(v_batch) AS item
  );

  INSERT INTO public.wd_vehicles (
    wd_car_id, car_group_id, identifier, description, vehicle_type,
    default_driver, active, online, odometer_km,
    installation_date, disable_date, raw_data, last_import_at, updated_at
  )
  SELECT
    (item->>'wd_car_id')::integer,
    (item->>'car_group_id')::integer,
    item->>'identifier',
    item->>'description',
    (item->>'vehicle_type')::integer,
    item->>'default_driver',
    COALESCE((item->>'active')::boolean, true),
    (item->>'online')::boolean,
    (item->>'odometer_km')::numeric,
    NULLIF(item->>'installation_date', '')::timestamptz,
    NULLIF(item->>'disable_date', '')::timestamptz,
    item->'raw',
    now(),
    now()
  FROM jsonb_array_elements(v_batch) AS item
  ON CONFLICT (wd_car_id) DO UPDATE SET
    car_group_id      = EXCLUDED.car_group_id,
    identifier        = EXCLUDED.identifier,
    description       = EXCLUDED.description,
    vehicle_type      = EXCLUDED.vehicle_type,
    default_driver    = EXCLUDED.default_driver,
    active            = EXCLUDED.active,
    online            = EXCLUDED.online,
    odometer_km       = EXCLUDED.odometer_km,
    installation_date = EXCLUDED.installation_date,
    disable_date      = EXCLUDED.disable_date,
    raw_data          = EXCLUDED.raw_data,
    last_import_at    = EXCLUDED.last_import_at,
    updated_at        = now();

  v_inserted := v_total - v_updated;

  -- Audit log
  INSERT INTO public.audit_journal (user_id, action, metadata)
  VALUES (
    auth.uid(),
    'wd_vehicles.import_completed',
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

REVOKE ALL ON FUNCTION public.wd_upsert_vehicles_audited(jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.wd_upsert_vehicles_audited(jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.wd_upsert_vehicles_audited(jsonb) TO service_role;
