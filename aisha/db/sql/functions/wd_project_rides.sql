-- ============================================================================
-- Source of Truth: wd_project_rides
-- Popis: TENKÝ ADAPTÉR kniha jízd Webdispečinku (wd_rides) → twin_project_trips.
--        Přeloží řádky do tvaru jádra; identitu, druh entity, porovnání
--        a zápis dělá jádro (dráha 'webdispecink:trip').
--
-- Klíče stejné jako wd_propose_identity: vozidlo = holé wd_car_id, řidič =
-- 'ridic:<wd_driver_id>' (zdroj identity 'webdispecink').
--
-- Které jízdy posílá (šetrně — volá se po každé synchronizaci):
--   • dosud NEPROMÍTNUTÉ jízdy vozidel s potvrzenou a k času jízdy platnou
--     vazbou (levné předběžné síto; rozhoduje jádro),
--   • jízdy, na které synchronizace sáhla v posledních `p_okno_min` minutách
--     (dodavatel opravuje zpětně; jádro zapíše jen skutečné změny).
-- Jízdy bez platné vazby se jen spočítají (`ceka_na_vazbu`) a promítnou se
-- samy, až člověk vazbu potvrdí.
--
-- Atributy = jen to, co je o VOZIDLE a jízdě: kilometry, tachometr, doba jízdy
-- a stání, druh jízdy. Místa začátku a konce, účel, posádka ani poznámka se
-- NEPŘENÁŠEJÍ (polohy majitel nepovolil, adresa soukromé jízdy i posádka jsou
-- osobní údaje); nejvyšší rychlost také ne (hodnocení chování řidiče).
--
-- Vrací: výsledek twin_project_trips + {ceka_na_vazbu}
-- Bezpečnost: SECURITY DEFINER; jen service_role (volá plugin přes broker).
-- ============================================================================
CREATE OR REPLACE FUNCTION public.wd_project_rides(
  p_okno_min integer DEFAULT 180,
  p_limit    integer DEFAULT 5000
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  c_source   constant text := 'webdispecink';
  v_source   text;
  v_lane     text;
  v_rows     jsonb;
  v_ceka     integer;
  v_vysledek jsonb;
BEGIN
  IF NOT public.is_service_role() THEN
    RAISE EXCEPTION 'wd_project_rides: service role required'
      USING ERRCODE = '42501';
  END IF;
  IF p_okno_min IS NULL OR p_okno_min < 0 OR p_okno_min > 10080 THEN
    RAISE EXCEPTION 'wd_project_rides: p_okno_min must be between 0 and 10080'
      USING ERRCODE = '22023';
  END IF;
  IF p_limit IS NULL OR p_limit < 1 OR p_limit > 20000 THEN
    RAISE EXCEPTION 'wd_project_rides: p_limit must be between 1 and 20000'
      USING ERRCODE = '22023';
  END IF;
  v_source := public.canonical_ingest_source(c_source);
  v_lane   := v_source || ':trip';

  WITH vse AS (
    SELECT r.wd_ride_id, r.wd_car_id, r.wd_driver_id, r.start_time, r.end_time,
           r.distance_km, r.odometer_start_km, r.odometer_end_km, r.driving_seconds,
           r.standing_seconds, r.ride_type, r.updated_at,
           EXISTS (SELECT 1 FROM public.twin_events e
                    WHERE e.source = v_lane AND e.event_type = 'trip'
                      AND e.source_ref = r.wd_ride_id::text) AS promitnuto,
           EXISTS (SELECT 1 FROM public.twin_external_refs b
                    WHERE b.source = v_source AND b.source_key = r.wd_car_id::text
                      AND b.ref_kind = 'primary_id' AND b.state = 'confirmed'
                      AND b.valid_from <= r.start_time
                      AND (b.valid_to IS NULL OR b.valid_to > r.start_time)) AS vazba
      FROM public.wd_rides r
     WHERE r.start_time IS NOT NULL
  ),
  kandidati AS (
    SELECT a.wd_ride_id, a.wd_car_id, a.wd_driver_id, a.start_time, a.end_time,
           a.distance_km, a.odometer_start_km, a.odometer_end_km, a.driving_seconds,
           a.standing_seconds, a.ride_type
      FROM vse a
     WHERE a.vazba
       AND (NOT a.promitnuto OR a.updated_at >= now() - make_interval(mins => p_okno_min))
     ORDER BY a.start_time
     LIMIT p_limit
  )
  SELECT
    (SELECT coalesce(jsonb_agg(jsonb_build_object(
              'source_ref',  k.wd_ride_id::text,
              'vehicle_key', k.wd_car_id::text,
              'driver_key',  'ridic:' || k.wd_driver_id,
              'started_at',  k.start_time,
              'ended_at',    k.end_time,
              'attrs',       jsonb_strip_nulls(jsonb_build_object(
                               'distance_km',       k.distance_km,
                               'odometer_start_km', k.odometer_start_km,
                               'odometer_end_km',   k.odometer_end_km,
                               'driving_seconds',   k.driving_seconds,
                               'standing_seconds',  k.standing_seconds,
                               'ride_type',         k.ride_type))
            ) ORDER BY k.start_time), '[]'::jsonb)
       FROM kandidati k),
    (SELECT count(*) FROM vse a WHERE NOT a.promitnuto AND NOT a.vazba)
  INTO v_rows, v_ceka;

  v_vysledek := public.twin_project_trips(c_source, v_rows);
  RETURN v_vysledek || jsonb_build_object('ceka_na_vazbu', v_ceka);
END;
$$;

REVOKE ALL ON FUNCTION public.wd_project_rides(integer, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.wd_project_rides(integer, integer) TO service_role;
