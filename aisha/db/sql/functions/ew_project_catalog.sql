-- ============================================================================
-- Source of Truth: ew_project_catalog
-- Popis: TENKÝ ADAPTÉR surové dráhy Eurowagu (source_catalog_rows, zdroj
--        'eurowag-telematics') → obecné jádro projekce. Přeloží řádky do tvaru
--        jádra; identitu, druh entity, porovnání a zápis dělá jádro.
--
--   jízdy ('trip')          → twin_project_trips, dráha 'eurowag-telematics:trip':
--                             km, spotřeba, l/100 km, doba, palivo, CO₂, náklad.
--                             Katalog určuje, co se sčítá: nájezd má autoritu
--                             Webdispečink (majitel 2026-09-27), spotřeba Eurowag.
--   stavy ('vehicle_state') → twin_project_events 'vehicle_state', dráha
--                             'eurowag-telematics:vehicle-state': tachometr (km),
--                             hladina (l), zapalování — ŽÁDNÁ poloha (plugin ji
--                             ani neukládá).
--
-- Klíče stejné jako ew_propose_identity: 'vozidlo:<monitoredObjectId>',
-- 'osoba:<driver id>'.
--
-- Které záznamy posílá (šetrně — volá se po každé synchronizaci):
--   • dosud NEPROMÍTNUTÉ záznamy vozidel s potvrzenou a k času platnou vazbou,
--   • záznamy, které synchronizace uložila v posledních `p_okno_min` minutách.
-- Stavy jen za posledních `p_stavy_dni` dní: řada roste po hodinách a hladina
-- se čte jako POSLEDNÍ hodnota — staré nepromítnuté stavy by jen zdržovaly.
-- Záznamy bez platné vazby se spočítají (`ceka_na_vazbu`) a promítnou se samy,
-- až člověk vazbu potvrdí.
--
-- Vrací: {jizdy: <výsledek twin_project_trips> + ceka_na_vazbu,
--         stavy: <výsledek twin_project_events> + ceka_na_vazbu}
-- Bezpečnost: SECURITY DEFINER; jen service_role (volá plugin přes broker).
-- ============================================================================
CREATE OR REPLACE FUNCTION public.ew_project_catalog(
  p_okno_min   integer DEFAULT 180,
  p_limit      integer DEFAULT 5000,
  p_stavy_dni  integer DEFAULT 30
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  c_source     constant text := 'eurowag-telematics';
  v_source     text;
  v_jizdy      jsonb;
  v_stavy      jsonb;
  v_ceka_j     integer;
  v_ceka_s     integer;
BEGIN
  IF NOT public.is_service_role() THEN
    RAISE EXCEPTION 'ew_project_catalog: service role required'
      USING ERRCODE = '42501';
  END IF;
  IF p_okno_min IS NULL OR p_okno_min < 0 OR p_okno_min > 10080 THEN
    RAISE EXCEPTION 'ew_project_catalog: p_okno_min must be between 0 and 10080'
      USING ERRCODE = '22023';
  END IF;
  IF p_limit IS NULL OR p_limit < 1 OR p_limit > 20000 THEN
    RAISE EXCEPTION 'ew_project_catalog: p_limit must be between 1 and 20000'
      USING ERRCODE = '22023';
  END IF;
  IF p_stavy_dni IS NULL OR p_stavy_dni < 1 OR p_stavy_dni > 366 THEN
    RAISE EXCEPTION 'ew_project_catalog: p_stavy_dni must be between 1 and 366'
      USING ERRCODE = '22023';
  END IF;
  v_source := public.canonical_ingest_source(c_source);

  -- ── jízdy ─────────────────────────────────────────────────────────────────
  WITH vse AS (
    SELECT c.external_id, c.occurred_at, c.synced_at, c.fields,
           'vozidlo:' || (c.fields->>'monitored_object_id') AS v_key,
           EXISTS (SELECT 1 FROM public.twin_events e
                    WHERE e.source = v_source || ':trip' AND e.event_type = 'trip'
                      AND e.source_ref = c.external_id) AS promitnuto,
           EXISTS (SELECT 1 FROM public.twin_external_refs b
                    WHERE b.source = v_source
                      AND b.source_key = 'vozidlo:' || (c.fields->>'monitored_object_id')
                      AND b.ref_kind = 'primary_id' AND b.state = 'confirmed'
                      AND b.valid_from <= c.occurred_at
                      AND (b.valid_to IS NULL OR b.valid_to > c.occurred_at)) AS vazba
      FROM public.source_catalog_rows c
     WHERE c.source_slug = c_source AND c.kind = 'trip' AND c.occurred_at IS NOT NULL
       AND nullif(c.fields->>'monitored_object_id', '') IS NOT NULL
  ),
  kandidati AS (
    SELECT a.external_id, a.occurred_at, a.fields, a.v_key
      FROM vse a
     WHERE a.vazba
       AND (NOT a.promitnuto OR a.synced_at >= now() - make_interval(mins => p_okno_min))
     ORDER BY a.occurred_at
     LIMIT p_limit
  )
  SELECT
    (SELECT coalesce(jsonb_agg(jsonb_build_object(
              'source_ref',  k.external_id,
              'vehicle_key', k.v_key,
              'driver_key',  'osoba:' || nullif(k.fields->>'driver_id', ''),
              'started_at',  k.occurred_at,
              'ended_at',    nullif(k.fields->>'end_time', ''),
              'attrs',       jsonb_strip_nulls(jsonb_build_object(
                               'distance_km',         k.fields->'distance_km',
                               'consumption_l',       k.fields->'consumption_l',
                               'consumption_l_100km', k.fields->'consumption_l_100km',
                               'duration_seconds',    k.fields->'duration_s',
                               'fuel_type',           k.fields->'fuel_type',
                               'co2_emission',        k.fields->'co2_emission',
                               'cargo_weight_kg',     k.fields->'cargo_weight_kg'))
            ) ORDER BY k.occurred_at), '[]'::jsonb)
       FROM kandidati k),
    (SELECT count(*) FROM vse a WHERE NOT a.promitnuto AND NOT a.vazba)
  INTO v_jizdy, v_ceka_j;

  -- ── stavy vozidel ─────────────────────────────────────────────────────────
  WITH vse AS (
    SELECT c.external_id, c.occurred_at, c.synced_at, c.fields,
           'vozidlo:' || (c.fields->>'monitored_object_id') AS v_key,
           EXISTS (SELECT 1 FROM public.twin_events e
                    WHERE e.source = v_source || ':vehicle-state' AND e.event_type = 'vehicle_state'
                      AND e.source_ref = c.external_id) AS promitnuto,
           EXISTS (SELECT 1 FROM public.twin_external_refs b
                    WHERE b.source = v_source
                      AND b.source_key = 'vozidlo:' || (c.fields->>'monitored_object_id')
                      AND b.ref_kind = 'primary_id' AND b.state = 'confirmed'
                      AND b.valid_from <= c.occurred_at
                      AND (b.valid_to IS NULL OR b.valid_to > c.occurred_at)) AS vazba
      FROM public.source_catalog_rows c
     WHERE c.source_slug = c_source AND c.kind = 'vehicle_state'
       AND c.occurred_at >= now() - make_interval(days => p_stavy_dni)
       AND nullif(c.fields->>'monitored_object_id', '') IS NOT NULL
  ),
  kandidati AS (
    SELECT a.external_id, a.occurred_at, a.fields, a.v_key
      FROM vse a
     WHERE a.vazba
       AND (NOT a.promitnuto OR a.synced_at >= now() - make_interval(mins => p_okno_min))
     ORDER BY a.occurred_at
     LIMIT p_limit
  )
  SELECT
    (SELECT coalesce(jsonb_agg(jsonb_build_object(
              'event_type',  'vehicle_state',
              'lane',        'vehicle-state',
              'source_ref',  k.external_id,
              'subject',     jsonb_build_object('key', k.v_key, 'ref_kind', 'primary_id', 'entity_type', 'vehicle'),
              'occurred_at', k.occurred_at,
              'attrs',       jsonb_strip_nulls(jsonb_build_object(
                               'odometer_km',  k.fields->'odometer_km',
                               'fuel_level_l', k.fields->'fuel_level_l',
                               'ignition',     k.fields->'ignition'))
            ) ORDER BY k.occurred_at), '[]'::jsonb)
       FROM kandidati k),
    (SELECT count(*) FROM vse a WHERE NOT a.promitnuto AND NOT a.vazba)
  INTO v_stavy, v_ceka_s;

  RETURN jsonb_build_object(
    'jizdy', public.twin_project_trips(c_source, v_jizdy) || jsonb_build_object('ceka_na_vazbu', v_ceka_j),
    'stavy', public.twin_project_events(c_source, v_stavy) || jsonb_build_object('ceka_na_vazbu', v_ceka_s)
  );
END;
$$;

REVOKE ALL ON FUNCTION public.ew_project_catalog(integer, integer, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ew_project_catalog(integer, integer, integer) TO service_role;
