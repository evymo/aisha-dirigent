-- ============================================================================
-- Source of Truth: tc_project_rides
-- Popis: TENKÝ ADAPTÉR T-cars → twin_project_trips. Přeloží řádky kniha jízd
--        (tc_rides) do tvaru obecného jádra a nic víc: identitu, porovnání
--        a zápis dělá jádro. Až T-cars přejde na obecnou surovou dráhu
--        (source_catalog_rows), nahradí se JEN tahle funkce — jádro zůstane.
--
-- Které jízdy posílá (šetrně — volá se po každé synchronizaci):
--   • dosud NEPROMÍTNUTÉ jízdy vozidel, jejichž vazba je k času jízdy potvrzená
--     a platná (levné předběžné síto; rozhoduje jádro přes twin_identity_resolve),
--   • a jízdy, na které synchronizace sáhla v posledních `p_okno_min` minutách
--     (překryv oken: dodavatel opravuje zpětně). Jádro z nich zapíše jen ty,
--     které se opravdu změnily.
-- Klíče vozidla a řidiče nesou druh objektu ('vozidlo:…', 'osoba:…') — T-cars
-- čísluje obojí zvlášť a vazba identity je jedinečná bez druhu entity (viz
-- tc_propose_identity). Adaptér a návrhy musí klíč skládat STEJNĚ.
--
-- Jízdy vozidel bez platné vazby se neposílají, jen spočítají
-- (`ceka_na_vazbu`) — promítnou se samy, až člověk vazbu potvrdí.
--
-- Atributy = jen to, co měří katalog a co je o VOZIDLE: kilometry, tachometr,
-- soukromá jízda, země. Místa začátku a konce se NEPŘENÁŠEJÍ: polohy majitel
-- nepovolil a adresa soukromé jízdy je osobní údaj řidiče.
--
-- Vrací: výsledek twin_project_trips + {ceka_na_vazbu}
-- Bezpečnost: SECURITY DEFINER; jen service_role (volá plugin přes broker).
-- ============================================================================
CREATE OR REPLACE FUNCTION public.tc_project_rides(
  p_okno_min integer DEFAULT 180,
  p_limit    integer DEFAULT 5000
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  c_source  constant text := 'tcars-fleet';
  v_lane    text;
  v_rows    jsonb;
  v_ceka    integer;
  v_vysledek jsonb;
BEGIN
  IF NOT public.is_service_role() THEN
    RAISE EXCEPTION 'tc_project_rides: service role required'
      USING ERRCODE = '42501';
  END IF;
  IF p_okno_min IS NULL OR p_okno_min < 0 OR p_okno_min > 10080 THEN
    RAISE EXCEPTION 'tc_project_rides: p_okno_min must be between 0 and 10080'
      USING ERRCODE = '22023';
  END IF;
  IF p_limit IS NULL OR p_limit < 1 OR p_limit > 20000 THEN
    RAISE EXCEPTION 'tc_project_rides: p_limit must be between 1 and 20000'
      USING ERRCODE = '22023';
  END IF;
  v_lane := public.canonical_ingest_source(c_source) || ':trip';

  WITH kandidati AS (
    SELECT r.tc_ride_id, r.tc_vehicle_id, r.tc_driver_id, r.start_time, r.end_time,
           r.distance_km, r.odometer_start_km, r.odometer_end_km, r.private, r.country
      FROM public.tc_rides r
     WHERE r.start_time IS NOT NULL
       AND EXISTS (
             SELECT 1 FROM public.twin_external_refs b
              WHERE b.source = public.canonical_ingest_source(c_source)
                AND b.source_key = 'vozidlo:' || r.tc_vehicle_id
                AND b.ref_kind = 'primary_id'
                AND b.state = 'confirmed'
                AND b.valid_from <= r.start_time
                AND (b.valid_to IS NULL OR b.valid_to > r.start_time))
       AND (r.updated_at >= now() - make_interval(mins => p_okno_min)
            OR NOT EXISTS (
                 SELECT 1 FROM public.twin_events e
                  WHERE e.source = v_lane AND e.event_type = 'trip'
                    AND e.source_ref = r.tc_ride_id::text))
     ORDER BY r.start_time
     LIMIT p_limit
  )
  SELECT coalesce(jsonb_agg(jsonb_build_object(
           'source_ref',  k.tc_ride_id::text,
           'vehicle_key', 'vozidlo:' || k.tc_vehicle_id,
           'driver_key',  'osoba:' || k.tc_driver_id,
           'started_at',  k.start_time,
           'ended_at',    k.end_time,
           'attrs',       jsonb_strip_nulls(jsonb_build_object(
                            'distance_km',       k.distance_km,
                            'odometer_start_km', k.odometer_start_km,
                            'odometer_end_km',   k.odometer_end_km,
                            'private',           k.private,
                            'country',           k.country))
         ) ORDER BY k.start_time), '[]'::jsonb)
    INTO v_rows
    FROM kandidati k;

  -- Kolik jízd čeká na člověka (vazba vozidla chybí nebo k času jízdy neplatí).
  SELECT count(*) INTO v_ceka
    FROM public.tc_rides r
   WHERE NOT EXISTS (
           SELECT 1 FROM public.twin_events e
            WHERE e.source = v_lane AND e.event_type = 'trip'
              AND e.source_ref = r.tc_ride_id::text)
     AND NOT EXISTS (
           SELECT 1 FROM public.twin_external_refs b
            WHERE b.source = public.canonical_ingest_source(c_source)
              AND b.source_key = 'vozidlo:' || r.tc_vehicle_id
              AND b.ref_kind = 'primary_id'
              AND b.state = 'confirmed'
              AND b.valid_from <= r.start_time
              AND (b.valid_to IS NULL OR b.valid_to > r.start_time));

  v_vysledek := public.twin_project_trips(c_source, v_rows);
  RETURN v_vysledek || jsonb_build_object('ceka_na_vazbu', v_ceka);
END;
$$;

REVOKE ALL ON FUNCTION public.tc_project_rides(integer, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.tc_project_rides(integer, integer) TO service_role;
