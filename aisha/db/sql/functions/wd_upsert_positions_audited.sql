-- ============================================================================
-- Source of Truth: wd_upsert_positions_audited
-- Popis: Batch zápis poloh z _getAllCarsPosition. Do historie appenduje
--        (dedup UNIQUE wd_car_id+position_time — stojící vozidlo vrací
--        stejnou polohu), poslední polohu upsertuje do current (jen novější).
--        wd_driver_id dopočítává z driver_card ↔ wd_drivers.card_identifier.
-- Bezpečnost: SECURITY DEFINER + REVOKE/GRANT
-- Audit: wd_positions.import_completed s počty (bez PII)
-- ============================================================================

CREATE OR REPLACE FUNCTION public.wd_upsert_positions_audited(
  p_positions jsonb
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
  v_history_inserted integer;
  v_current_upserted integer;
BEGIN
  -- Authorization check (FIRST, before any data access)
  IF NOT v_is_service AND NOT public.is_admin_or_staff() THEN
    RAISE EXCEPTION 'Unauthorized: admin, staff, or service_role required';
  END IF;

  -- Input validation
  IF p_positions IS NULL OR jsonb_typeof(p_positions) <> 'array' THEN
    RAISE EXCEPTION 'p_positions must be a jsonb array';
  END IF;

  -- Dedup: poslední poloha na (wd_car_id, position_time)
  SELECT COALESCE(jsonb_agg(deduped.item), '[]'::jsonb) INTO v_batch
  FROM (
    SELECT DISTINCT ON ((item->>'wd_car_id')::integer, (item->>'position_time')::timestamptz) item
    FROM jsonb_array_elements(p_positions) AS item
    WHERE item->>'wd_car_id' IS NOT NULL
      AND NULLIF(item->>'position_time', '') IS NOT NULL
  ) AS deduped;

  v_total := jsonb_array_length(v_batch);

  INSERT INTO public.wd_vehicles (
    wd_car_id, raw_data, last_import_at, updated_at
  )
  SELECT DISTINCT
    (item->>'wd_car_id')::integer,
    jsonb_build_object('placeholder', true, 'source', 'wd_upsert_positions_audited'),
    now(),
    now()
  FROM jsonb_array_elements(v_batch) AS item
  ON CONFLICT (wd_car_id) DO NOTHING;

  -- Historie: append-only, konflikt = poloha už uložená z předchozího pollu
  WITH src AS (
    SELECT
      (item->>'wd_car_id')::integer AS wd_car_id,
      NULLIF(item->>'driver_card', '') AS driver_card,
      (item->>'position_time')::timestamptz AS position_time,
      (item->>'latitude')::numeric AS latitude,
      (item->>'longitude')::numeric AS longitude,
      (item->>'speed_kmh')::numeric AS speed_kmh,
      (item->>'moving')::boolean AS moving,
      NULLIF(item->>'location_text', '') AS location_text,
      (item->>'odometer_km')::numeric AS odometer_km,
      (item->>'fuel_level')::numeric AS fuel_level,
      (item->>'used_fuel')::numeric AS used_fuel,
      item->'raw' AS raw_data
    FROM jsonb_array_elements(v_batch) AS item
  ),
  ins AS (
    INSERT INTO public.wd_vehicle_positions_history (
      wd_car_id, wd_driver_id, driver_card, position_time,
      latitude, longitude, speed_kmh, moving, location_text,
      odometer_km, fuel_level, used_fuel, raw_data
    )
    SELECT
      s.wd_car_id, d.wd_driver_id, s.driver_card, s.position_time,
      s.latitude, s.longitude, s.speed_kmh, s.moving, s.location_text,
      s.odometer_km, s.fuel_level, s.used_fuel, s.raw_data
    FROM src s
    LEFT JOIN public.wd_drivers d
      ON s.driver_card IS NOT NULL AND d.card_identifier = s.driver_card
    ON CONFLICT (wd_car_id, position_time) DO NOTHING
    RETURNING 1
  )
  SELECT count(*) INTO v_history_inserted FROM ins;

  -- Current: jeden řádek na vozidlo, přepsat jen novější polohou
  WITH src AS (
    SELECT DISTINCT ON ((item->>'wd_car_id')::integer)
      (item->>'wd_car_id')::integer AS wd_car_id,
      NULLIF(item->>'driver_card', '') AS driver_card,
      (item->>'position_time')::timestamptz AS position_time,
      (item->>'latitude')::numeric AS latitude,
      (item->>'longitude')::numeric AS longitude,
      (item->>'speed_kmh')::numeric AS speed_kmh,
      (item->>'moving')::boolean AS moving,
      NULLIF(item->>'location_text', '') AS location_text,
      (item->>'odometer_km')::numeric AS odometer_km,
      (item->>'fuel_level')::numeric AS fuel_level,
      (item->>'used_fuel')::numeric AS used_fuel,
      item->'raw' AS raw_data
    FROM jsonb_array_elements(v_batch) AS item
    ORDER BY (item->>'wd_car_id')::integer, (item->>'position_time')::timestamptz DESC
  ),
  up AS (
    INSERT INTO public.wd_vehicle_positions_current (
      wd_car_id, wd_driver_id, driver_card, position_time,
      latitude, longitude, speed_kmh, moving, location_text,
      odometer_km, fuel_level, used_fuel, raw_data, updated_at
    )
    SELECT
      s.wd_car_id, d.wd_driver_id, s.driver_card, s.position_time,
      s.latitude, s.longitude, s.speed_kmh, s.moving, s.location_text,
      s.odometer_km, s.fuel_level, s.used_fuel, s.raw_data, now()
    FROM src s
    LEFT JOIN public.wd_drivers d
      ON s.driver_card IS NOT NULL AND d.card_identifier = s.driver_card
    ON CONFLICT (wd_car_id) DO UPDATE SET
      wd_driver_id  = EXCLUDED.wd_driver_id,
      driver_card   = EXCLUDED.driver_card,
      position_time = EXCLUDED.position_time,
      latitude      = EXCLUDED.latitude,
      longitude     = EXCLUDED.longitude,
      speed_kmh     = EXCLUDED.speed_kmh,
      moving        = EXCLUDED.moving,
      location_text = EXCLUDED.location_text,
      odometer_km   = EXCLUDED.odometer_km,
      fuel_level    = EXCLUDED.fuel_level,
      used_fuel     = EXCLUDED.used_fuel,
      raw_data      = EXCLUDED.raw_data,
      updated_at    = now()
    WHERE wd_vehicle_positions_current.position_time <= EXCLUDED.position_time
    RETURNING 1
  )
  SELECT count(*) INTO v_current_upserted FROM up;

  -- Audit log (počty; polohy samotné jsou v datových tabulkách)
  INSERT INTO public.audit_journal (user_id, action, metadata)
  VALUES (
    auth.uid(),
    'wd_positions.import_completed',
    jsonb_build_object(
      'total', v_total,
      'history_inserted', v_history_inserted,
      'current_upserted', v_current_upserted
    )
  );

  RETURN jsonb_build_object(
    'total', v_total,
    'history_inserted', v_history_inserted,
    'current_upserted', v_current_upserted
  );
END;
$$;

REVOKE ALL ON FUNCTION public.wd_upsert_positions_audited(jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.wd_upsert_positions_audited(jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.wd_upsert_positions_audited(jsonb) TO service_role;
