-- Function: public.evidence_device_geo
-- Arguments: p_device jsonb, p_derived jsonb
-- Security: INVOKER, STABLE — nesahá na žádnou tabulku (STABLE, ne IMMUTABLE:
--           převod textu na timestamptz závisí na TimeZone relace). Volá ji
--           submit_evidence_review_audited (definer); sama není RPC.
--
-- Poloha TABLETU k potvrzení předání → normalizovaný záznam `device_geo`.
--
-- ⭐ ROZHODNUTÍ MAJITELE (2026-09-18). Pravidlo z 2026-07-28 platí dál: DŮKAZNÍ
-- poloha předání se ODVOZUJE (workflow_step_derived_position — signál příjezdu,
-- telematika vozu) a souřadnice od toho, koho záznam dokumentuje, důkaz není.
-- Poloha tabletu je DALŠÍ METAINFORMACE vedle ní: zvyšuje důvěryhodnost záznamu
-- v čase a místě, nikdy nenahrazuje `geo`. Proto má vlastní klíč a `geo_source`
-- začínající `device`, aby se nedala zaměnit s odvozenou polohou.
--
-- ⭐ SHODA DVOU ZDROJŮ je to, co důvěryhodnost skutečně zvyšuje: když má odvozená
-- poloha souřadnice, spočítá se vzdálenost (`agreement_m`, haversine, metry).
-- Samotná poloha tabletu bez druhého zdroje je jen tvrzení zařízení.
--
-- Tvar vstupu (uzavřený; neznámý klíč nebo hodnota = výjimka 22023, stejně
-- jako uzavřená množina klíčů evidence — překlep nesmí tiše zmizet):
--   { lat, lon, accuracy_m?, captured_at }     — naměřená poloha
--   { unavailable: denied|disabled|timeout|error } — poctivá mezera
--   NULL                                        — klient polohu neposlal
CREATE OR REPLACE FUNCTION public.evidence_device_geo(p_device jsonb, p_derived jsonb DEFAULT NULL::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public', pg_temp
AS $function$
DECLARE
  v_stray  text;
  v_lat    double precision;
  v_lon    double precision;
  v_acc    double precision;
  v_at     timestamptz;
  v_out    jsonb;
  v_dlat   double precision;
  v_dlon   double precision;
  v_a      double precision;
BEGIN
  IF p_device IS NULL OR jsonb_typeof(p_device) = 'null' THEN
    RETURN NULL;
  END IF;
  IF jsonb_typeof(p_device) <> 'object' THEN
    RAISE EXCEPTION 'device_position must be an object' USING errcode = '22023';
  END IF;

  IF p_device ? 'unavailable' THEN
    SELECT string_agg(k, ', ') INTO v_stray FROM jsonb_object_keys(p_device) k WHERE k <> 'unavailable';
    IF v_stray IS NOT NULL THEN
      RAISE EXCEPTION 'device_position.unavailable carries no other keys (got: %)', v_stray USING errcode = '22023';
    END IF;
    IF coalesce(p_device->>'unavailable', '') NOT IN ('denied', 'disabled', 'timeout', 'error') THEN
      RAISE EXCEPTION 'device_position.unavailable must be denied, disabled, timeout or error (got: %)',
        p_device->>'unavailable' USING errcode = '22023';
    END IF;
    RETURN jsonb_build_object('geo_source', 'device_unavailable', 'reason', p_device->>'unavailable');
  END IF;

  SELECT string_agg(k, ', ') INTO v_stray
    FROM jsonb_object_keys(p_device) k
   WHERE k NOT IN ('lat', 'lon', 'accuracy_m', 'captured_at');
  IF v_stray IS NOT NULL THEN
    RAISE EXCEPTION 'unknown device_position key(s): % (allowed: lat, lon, accuracy_m, captured_at)', v_stray
      USING errcode = '22023';
  END IF;

  IF jsonb_typeof(p_device->'lat') IS DISTINCT FROM 'number' OR jsonb_typeof(p_device->'lon') IS DISTINCT FROM 'number' THEN
    RAISE EXCEPTION 'device_position needs numeric lat and lon' USING errcode = '22023';
  END IF;
  v_lat := (p_device->>'lat')::double precision;
  v_lon := (p_device->>'lon')::double precision;
  IF v_lat NOT BETWEEN -90 AND 90 OR v_lon NOT BETWEEN -180 AND 180 THEN
    RAISE EXCEPTION 'device_position out of range (lat %, lon %)', v_lat, v_lon USING errcode = '22023';
  END IF;

  IF p_device ? 'accuracy_m' AND jsonb_typeof(p_device->'accuracy_m') <> 'null' THEN
    IF jsonb_typeof(p_device->'accuracy_m') <> 'number' OR (p_device->>'accuracy_m')::double precision < 0 THEN
      RAISE EXCEPTION 'device_position.accuracy_m must be a non-negative number' USING errcode = '22023';
    END IF;
    v_acc := (p_device->>'accuracy_m')::double precision;
  END IF;

  -- Čas měření je součást tvrzení: poloha bez času neříká, KDY tam tablet byl.
  IF coalesce(p_device->>'captured_at', '') = '' THEN
    RAISE EXCEPTION 'device_position.captured_at is required' USING errcode = '22023';
  END IF;
  BEGIN
    v_at := (p_device->>'captured_at')::timestamptz;
  EXCEPTION WHEN invalid_datetime_format OR datetime_field_overflow THEN
    RAISE EXCEPTION 'device_position.captured_at is not a timestamp (got: %)', p_device->>'captured_at'
      USING errcode = '22023';
  END;

  v_out := jsonb_strip_nulls(jsonb_build_object(
    'geo_source',  'device',
    'lat',         v_lat,
    'lon',         v_lon,
    'accuracy_m',  v_acc,
    'captured_at', v_at));

  -- Shoda s odvozenou polohou vozu. Jen když ta souřadnice MÁ — `unavailable`
  -- odvození se s ničím neporovnává, jinak by vzniklo číslo z ničeho.
  IF p_derived IS NOT NULL
     AND jsonb_typeof(p_derived->'lat') = 'number' AND jsonb_typeof(p_derived->'lon') = 'number' THEN
    v_dlat := radians((p_derived->>'lat')::double precision - v_lat);
    v_dlon := radians((p_derived->>'lon')::double precision - v_lon);
    v_a := power(sin(v_dlat / 2), 2)
         + cos(radians(v_lat)) * cos(radians((p_derived->>'lat')::double precision)) * power(sin(v_dlon / 2), 2);
    v_out := v_out || jsonb_build_object('agreement_m', round((2 * 6371000 * asin(least(1, sqrt(v_a))))::numeric));
  END IF;

  RETURN v_out;
END;
$function$
;

-- Žádný grant pro `authenticated`: tohle není blokové RPC, klient ho nevolá.
-- Jediná cesta k němu vede přes submit_evidence_review_audited (SECURITY DEFINER).
-- Stejně jako workflow_step_derived_position — výchozí práva Supabase by jinak
-- funkci vystavila v PostgRESTu jako volatelné RPC.
REVOKE ALL ON FUNCTION public.evidence_device_geo(jsonb, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.evidence_device_geo(jsonb, jsonb) TO service_role;
