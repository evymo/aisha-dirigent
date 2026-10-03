-- ============================================================================
-- Source of Truth: wd_project_worktime
-- Popis: TENKÝ ADAPTÉR denních výkonů řidičů z tachografu Webdispečinku
--        (wd_worktime, _getDriverWorkTacho) → twin_project_events. Událost
--        'driver_hours_day' na dvojčeti ŘIDIČE, dráha 'webdispecink:tachograph'
--        — přesně tvar, který čte katalog (driver_drive_h: attr drive_seconds,
--        převod na hodiny dělá katalog, ne adaptér).
--
-- Jeden řádek = řidič × den × vozidlo (tachograf dělí den podle vozidla); jedna
-- událost na řádek, takže součet za den je součet řádků. `occurred_at` je
-- půlnoc UTC daného dne a je to ŠTÍTEK PŘIHRÁDKY, ne okamžik — dodavatel dává
-- kalendářní den bez zóny; autoritativní je `attrs.work_date`.
--
-- Klíč řidiče 'ridic:<wd_driver_id>' (stejně jako wd_propose_identity).
-- Pracovní doba řidiče je osobní údaj: přenáší se jen souhrnné doby za den
-- a SPZ vozidla z tachografu, žádná místa ani nepřítomnosti (absences).
--
-- Které dny posílá: nepromítnuté dny řidičů s potvrzenou a k danému dni
-- platnou vazbou + dny, na které synchronizace sáhla v posledních `p_okno_min`
-- minutách (dnešek se doplňuje, ověřené dny chodí později).
--
-- Vrací: výsledek twin_project_events + {ceka_na_vazbu}
-- Bezpečnost: SECURITY DEFINER; jen service_role (volá plugin přes broker).
-- ============================================================================
CREATE OR REPLACE FUNCTION public.wd_project_worktime(
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
    RAISE EXCEPTION 'wd_project_worktime: service role required'
      USING ERRCODE = '42501';
  END IF;
  IF p_okno_min IS NULL OR p_okno_min < 0 OR p_okno_min > 10080 THEN
    RAISE EXCEPTION 'wd_project_worktime: p_okno_min must be between 0 and 10080'
      USING ERRCODE = '22023';
  END IF;
  IF p_limit IS NULL OR p_limit < 1 OR p_limit > 20000 THEN
    RAISE EXCEPTION 'wd_project_worktime: p_limit must be between 1 and 20000'
      USING ERRCODE = '22023';
  END IF;
  v_source := public.canonical_ingest_source(c_source);
  v_lane   := v_source || ':tachograph';

  WITH dny AS (
    SELECT w.wd_driver_id, w.work_date, w.car_identifikator, w.day_type,
           w.total_drive_seconds, w.total_work_seconds, w.total_rest_seconds,
           w.total_standby_seconds, w.night_drive_seconds, w.distance_km, w.updated_at,
           w.wd_driver_id || ':' || w.work_date || ':' || w.car_identifikator AS klic_dne,
           (w.work_date::timestamp AT TIME ZONE 'UTC') AS stitek
      FROM public.wd_worktime w
  ),
  vse AS (
    SELECT d.wd_driver_id, d.work_date, d.car_identifikator, d.day_type,
           d.total_drive_seconds, d.total_work_seconds, d.total_rest_seconds,
           d.total_standby_seconds, d.night_drive_seconds, d.distance_km, d.updated_at,
           d.klic_dne, d.stitek,
           EXISTS (SELECT 1 FROM public.twin_events e
                    WHERE e.source = v_lane AND e.event_type = 'driver_hours_day'
                      AND e.source_ref = d.klic_dne) AS promitnuto,
           EXISTS (SELECT 1 FROM public.twin_external_refs b
                    WHERE b.source = v_source AND b.source_key = 'ridic:' || d.wd_driver_id
                      AND b.ref_kind = 'primary_id' AND b.state = 'confirmed'
                      AND b.valid_from <= d.stitek
                      AND (b.valid_to IS NULL OR b.valid_to > d.stitek)) AS vazba
      FROM dny d
  ),
  kandidati AS (
    SELECT a.wd_driver_id, a.work_date, a.car_identifikator, a.day_type,
           a.total_drive_seconds, a.total_work_seconds, a.total_rest_seconds,
           a.total_standby_seconds, a.night_drive_seconds, a.distance_km, a.klic_dne, a.stitek
      FROM vse a
     WHERE a.vazba
       AND (NOT a.promitnuto OR a.updated_at >= now() - make_interval(mins => p_okno_min))
     ORDER BY a.work_date, a.wd_driver_id
     LIMIT p_limit
  )
  SELECT
    (SELECT coalesce(jsonb_agg(jsonb_build_object(
              'event_type',  'driver_hours_day',
              'lane',        'tachograph',
              'source_ref',  k.klic_dne,
              'subject',     jsonb_build_object('key', 'ridic:' || k.wd_driver_id,
                                                'ref_kind', 'primary_id', 'entity_type', 'driver'),
              'occurred_at', k.stitek,
              'attrs',       jsonb_strip_nulls(jsonb_build_object(
                               'work_date',            k.work_date,
                               'drive_seconds',        k.total_drive_seconds,
                               'work_seconds',         k.total_work_seconds,
                               'rest_seconds',         k.total_rest_seconds,
                               'availability_seconds', k.total_standby_seconds,
                               'night_drive_seconds',  k.night_drive_seconds,
                               'distance_km',          k.distance_km,
                               'day_type',             k.day_type,
                               'car',                  nullif(k.car_identifikator, '')))
            ) ORDER BY k.work_date, k.wd_driver_id), '[]'::jsonb)
       FROM kandidati k),
    (SELECT count(*) FROM vse a WHERE NOT a.promitnuto AND NOT a.vazba)
  INTO v_rows, v_ceka;

  v_vysledek := public.twin_project_events(c_source, v_rows);
  RETURN v_vysledek || jsonb_build_object('ceka_na_vazbu', v_ceka);
END;
$$;

REVOKE ALL ON FUNCTION public.wd_project_worktime(integer, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.wd_project_worktime(integer, integer) TO service_role;
