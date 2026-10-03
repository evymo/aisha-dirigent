-- ============================================================================
-- Source of Truth: tc_upsert_rides_audited
-- Popis: Batch upsert knihy jízd / práce strojů z T-cars (knihaJizdVozidlo).
--        Upsert podle tc_ride_id — kniha jízd se zpětně opravuje, opakovaný
--        import stejného okna aktualizuje existující jízdy. Doplněno
--        2026-07-25: sync.ts tuto RPC volal, ale v SoT chyběla.
-- Bezpečnost: SECURITY DEFINER + REVOKE/GRANT
-- Audit: tc_rides.import_completed s počty (bez PII)
-- ============================================================================

CREATE OR REPLACE FUNCTION public.tc_upsert_rides_audited(
  p_rides jsonb
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

  IF p_rides IS NULL OR jsonb_typeof(p_rides) <> 'array' THEN
    RAISE EXCEPTION 'p_rides must be a jsonb array';
  END IF;

  SELECT COALESCE(jsonb_agg(deduped.item), '[]'::jsonb) INTO v_batch
  FROM (
    SELECT DISTINCT ON ((item->>'tc_ride_id')::bigint) item
    FROM jsonb_array_elements(p_rides) AS item
    WHERE item->>'tc_ride_id' IS NOT NULL
  ) AS deduped;

  v_total := jsonb_array_length(v_batch);

  SELECT count(*) INTO v_updated
  FROM public.tc_rides r
  WHERE r.tc_ride_id IN (
    SELECT (item->>'tc_ride_id')::bigint
    FROM jsonb_array_elements(v_batch) AS item
  );

  INSERT INTO public.tc_rides (
    tc_ride_id, tc_vehicle_id, tc_driver_id, driver_name, responsible_name,
    start_time, end_time, start_place, end_place, country,
    odometer_start_km, odometer_end_km, distance_km, city_ratio,
    fuel_end, fuel_end_alt, private, purpose,
    cost_center_id, cost_center_name, raw_data, last_import_at, updated_at
  )
  SELECT
    (item->>'tc_ride_id')::bigint,
    (item->>'tc_vehicle_id')::integer,
    (item->>'tc_driver_id')::integer,
    item->>'driver_name',
    item->>'responsible_name',
    NULLIF(item->>'start_time', '')::timestamptz,
    NULLIF(item->>'end_time', '')::timestamptz,
    item->>'start_place',
    item->>'end_place',
    item->>'country',
    (item->>'odometer_start_km')::numeric,
    (item->>'odometer_end_km')::numeric,
    (item->>'distance_km')::numeric,
    (item->>'city_ratio')::numeric,
    (item->>'fuel_end')::numeric,
    (item->>'fuel_end_alt')::numeric,
    (item->>'private')::boolean,
    item->>'purpose',
    (item->>'cost_center_id')::integer,
    item->>'cost_center_name',
    item->'raw',
    now(),
    now()
  FROM jsonb_array_elements(v_batch) AS item
  ON CONFLICT (tc_ride_id) DO UPDATE SET
    tc_vehicle_id     = EXCLUDED.tc_vehicle_id,
    tc_driver_id      = EXCLUDED.tc_driver_id,
    driver_name       = EXCLUDED.driver_name,
    responsible_name  = EXCLUDED.responsible_name,
    start_time        = EXCLUDED.start_time,
    end_time          = EXCLUDED.end_time,
    start_place       = EXCLUDED.start_place,
    end_place         = EXCLUDED.end_place,
    country           = EXCLUDED.country,
    odometer_start_km = EXCLUDED.odometer_start_km,
    odometer_end_km   = EXCLUDED.odometer_end_km,
    distance_km       = EXCLUDED.distance_km,
    city_ratio        = EXCLUDED.city_ratio,
    fuel_end          = EXCLUDED.fuel_end,
    fuel_end_alt      = EXCLUDED.fuel_end_alt,
    private           = EXCLUDED.private,
    purpose           = EXCLUDED.purpose,
    cost_center_id    = EXCLUDED.cost_center_id,
    cost_center_name  = EXCLUDED.cost_center_name,
    raw_data          = EXCLUDED.raw_data,
    last_import_at    = EXCLUDED.last_import_at,
    updated_at        = now();

  v_inserted := v_total - v_updated;

  INSERT INTO public.audit_journal (user_id, action, metadata)
  VALUES (
    auth.uid(),
    'tc_rides.import_completed',
    jsonb_build_object('total', v_total, 'inserted', v_inserted, 'updated', v_updated)
  );

  RETURN jsonb_build_object('total', v_total, 'inserted', v_inserted, 'updated', v_updated);
END;
$$;

REVOKE ALL ON FUNCTION public.tc_upsert_rides_audited(jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.tc_upsert_rides_audited(jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.tc_upsert_rides_audited(jsonb) TO service_role;
