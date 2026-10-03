-- ============================================================================
-- Source of Truth: wd_upsert_rides_audited
-- Popis: Batch upsert knihy jízd z _getCarLogBook4. Upsert podle wd_ride_id
--        — kniha jízd se zpětně opravuje, opakovaný import stejného okna
--        aktualizuje existující jízdy (vč. dokončení rozpracované jízdy).
-- Bezpečnost: SECURITY DEFINER + REVOKE/GRANT
-- Audit: wd_rides.import_completed s počty (bez PII)
-- ============================================================================

CREATE OR REPLACE FUNCTION public.wd_upsert_rides_audited(
  p_rides jsonb
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
  IF p_rides IS NULL OR jsonb_typeof(p_rides) <> 'array' THEN
    RAISE EXCEPTION 'p_rides must be a jsonb array';
  END IF;

  -- Dedup podle wd_ride_id — ON CONFLICT nesmí zasáhnout stejný řádek dvakrát
  SELECT COALESCE(jsonb_agg(deduped.item), '[]'::jsonb) INTO v_batch
  FROM (
    SELECT DISTINCT ON ((item->>'wd_ride_id')::bigint) item
    FROM jsonb_array_elements(p_rides) AS item
    WHERE item->>'wd_ride_id' IS NOT NULL
      AND item->>'wd_car_id' IS NOT NULL
  ) AS deduped;

  v_total := jsonb_array_length(v_batch);

  SELECT count(*) INTO v_updated
  FROM public.wd_rides r
  WHERE r.wd_ride_id IN (
    SELECT (item->>'wd_ride_id')::bigint
    FROM jsonb_array_elements(v_batch) AS item
  );

  INSERT INTO public.wd_vehicles (
    wd_car_id, raw_data, last_import_at, updated_at
  )
  SELECT DISTINCT
    (item->>'wd_car_id')::integer,
    jsonb_build_object('placeholder', true, 'source', 'wd_upsert_rides_audited'),
    now(),
    now()
  FROM jsonb_array_elements(v_batch) AS item
  ON CONFLICT (wd_car_id) DO NOTHING;

  WITH src AS (
    SELECT
      (item->>'wd_ride_id')::bigint AS wd_ride_id,
      (item->>'wd_car_id')::integer AS wd_car_id,
      NULLIF(item->>'wd_driver_id', '')::integer AS raw_wd_driver_id,
      NULLIF(item->>'driver_name', '') AS driver_name,
      NULLIF(item->>'start_time', '')::timestamptz AS start_time,
      NULLIF(item->>'end_time', '')::timestamptz AS end_time,
      NULLIF(item->>'start_place', '') AS start_place,
      NULLIF(item->>'end_place', '') AS end_place,
      NULLIF(item->>'purpose', '') AS purpose,
      (item->>'ride_type')::integer AS ride_type,
      (item->>'distance_km')::numeric AS distance_km,
      (item->>'odometer_start_km')::numeric AS odometer_start_km,
      (item->>'odometer_end_km')::numeric AS odometer_end_km,
      (item->>'driving_seconds')::integer AS driving_seconds,
      (item->>'standing_seconds')::integer AS standing_seconds,
      (item->>'max_speed_kmh')::numeric AS max_speed_kmh,
      (item->>'avg_speed_kmh')::numeric AS avg_speed_kmh,
      NULLIF(item->>'crew', '') AS crew,
      NULLIF(item->>'note', '') AS note,
      item->'raw' AS raw_data
    FROM jsonb_array_elements(v_batch) AS item
  )
  INSERT INTO public.wd_rides (
    wd_ride_id, wd_car_id, wd_driver_id, driver_name,
    start_time, end_time, start_place, end_place, purpose, ride_type,
    distance_km, odometer_start_km, odometer_end_km,
    driving_seconds, standing_seconds, max_speed_kmh, avg_speed_kmh,
    crew, note, raw_data, last_import_at, updated_at
  )
  SELECT
    s.wd_ride_id,
    s.wd_car_id,
    d.wd_driver_id,
    s.driver_name,
    s.start_time,
    s.end_time,
    s.start_place,
    s.end_place,
    s.purpose,
    s.ride_type,
    s.distance_km,
    s.odometer_start_km,
    s.odometer_end_km,
    s.driving_seconds,
    s.standing_seconds,
    s.max_speed_kmh,
    s.avg_speed_kmh,
    s.crew,
    s.note,
    s.raw_data,
    now(),
    now()
  FROM src s
  LEFT JOIN public.wd_drivers d
    ON s.raw_wd_driver_id IS NOT NULL AND d.wd_driver_id = s.raw_wd_driver_id
  ON CONFLICT (wd_ride_id) DO UPDATE SET
    wd_car_id         = EXCLUDED.wd_car_id,
    wd_driver_id      = EXCLUDED.wd_driver_id,
    driver_name       = EXCLUDED.driver_name,
    start_time        = EXCLUDED.start_time,
    end_time          = EXCLUDED.end_time,
    start_place       = EXCLUDED.start_place,
    end_place         = EXCLUDED.end_place,
    purpose           = EXCLUDED.purpose,
    ride_type         = EXCLUDED.ride_type,
    distance_km       = EXCLUDED.distance_km,
    odometer_start_km = EXCLUDED.odometer_start_km,
    odometer_end_km   = EXCLUDED.odometer_end_km,
    driving_seconds   = EXCLUDED.driving_seconds,
    standing_seconds  = EXCLUDED.standing_seconds,
    max_speed_kmh     = EXCLUDED.max_speed_kmh,
    avg_speed_kmh     = EXCLUDED.avg_speed_kmh,
    crew              = EXCLUDED.crew,
    note              = EXCLUDED.note,
    raw_data          = EXCLUDED.raw_data,
    last_import_at    = EXCLUDED.last_import_at,
    updated_at        = now();

  v_inserted := v_total - v_updated;

  -- Audit log (jen počty — jména řidičů do auditu nepatří)
  INSERT INTO public.audit_journal (user_id, action, metadata)
  VALUES (
    auth.uid(),
    'wd_rides.import_completed',
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

REVOKE ALL ON FUNCTION public.wd_upsert_rides_audited(jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.wd_upsert_rides_audited(jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.wd_upsert_rides_audited(jsonb) TO service_role;
