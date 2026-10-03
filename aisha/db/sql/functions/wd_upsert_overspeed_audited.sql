-- ============================================================================
-- Source of Truth: wd_upsert_overspeed_audited
-- Popis: Batch upsert překročení rychlosti z _getCarOverSpeed. Upsert podle
--        (wd_car_id, time_from) — opakovaný import okna aktualizuje úseky.
-- Bezpečnost: SECURITY DEFINER + REVOKE/GRANT + fail-closed auth guard.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.wd_upsert_overspeed_audited(
  p_events jsonb
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
BEGIN
  IF NOT v_is_service AND NOT public.is_admin_or_staff() THEN
    RAISE EXCEPTION 'Unauthorized: admin, staff, or service_role required';
  END IF;

  IF p_events IS NULL OR jsonb_typeof(p_events) <> 'array' THEN
    RAISE EXCEPTION 'p_events must be a jsonb array';
  END IF;

  SELECT COALESCE(jsonb_agg(deduped.item), '[]'::jsonb) INTO v_batch
  FROM (
    SELECT DISTINCT ON ((item->>'wd_car_id')::integer, (item->>'time_from')::timestamptz) item
    FROM jsonb_array_elements(p_events) AS item
    WHERE item->>'wd_car_id' IS NOT NULL
      AND item->>'time_from' IS NOT NULL
  ) AS deduped;

  v_total := jsonb_array_length(v_batch);

  SELECT count(*) INTO v_updated
  FROM public.wd_overspeed o
  JOIN jsonb_array_elements(v_batch) AS item
    ON o.wd_car_id = (item->>'wd_car_id')::integer
   AND o.time_from = (item->>'time_from')::timestamptz;

  INSERT INTO public.wd_overspeed (
    wd_car_id, wd_driver_id, max_speed_kmh, time_from, time_to, lat, lon,
    distance_km, raw_data, last_import_at, updated_at
  )
  SELECT
    (item->>'wd_car_id')::integer,
    NULLIF(item->>'wd_driver_id', '')::integer,
    NULLIF(item->>'max_speed_kmh', '')::numeric,
    (item->>'time_from')::timestamptz,
    NULLIF(item->>'time_to', '')::timestamptz,
    NULLIF(item->>'lat', '')::numeric,
    NULLIF(item->>'lon', '')::numeric,
    NULLIF(item->>'distance_km', '')::numeric,
    item->'raw',
    now(),
    now()
  FROM jsonb_array_elements(v_batch) AS item
  ON CONFLICT (wd_car_id, time_from) DO UPDATE SET
    wd_driver_id   = EXCLUDED.wd_driver_id,
    max_speed_kmh  = EXCLUDED.max_speed_kmh,
    time_to        = EXCLUDED.time_to,
    lat            = EXCLUDED.lat,
    lon            = EXCLUDED.lon,
    distance_km    = EXCLUDED.distance_km,
    raw_data       = EXCLUDED.raw_data,
    last_import_at = now(),
    updated_at     = now();

  -- Sufix `_audited` je SLIB, ne ozdoba: brána `audited-function-integrity`
  -- vyžaduje, aby funkce s tímhle jménem do žurnálu opravdu psala. Bez toho
  -- je jméno tvrzení, které nikdo nesplnil.
  --
  -- ⭐ Jeden zápis za DÁVKU, ne za řádek. Import běží po tisících vět a audit
  -- per řádek by z jednoho běhu udělal tisíce zápisů — tedy z měřidla zátěž.
  -- ⛔ Do detailu jdou jen POČTY a jméno tabulky. Žádná SPZ, žádné jméno
  -- řidiče: doklad nese tvrzení, ne identitu, a žurnál není kopie dat.
  PERFORM public.write_audit_journal(
    p_action_type := 'integration'::public.journal_action_type,
    p_area        := 'system'::public.journal_area,
    p_details     := jsonb_build_object(
      'table', 'wd_overspeed',
      'total', v_total,
      'updated', v_updated,
      'inserted', v_total - v_updated,
      'via_service_role', v_is_service
    ),
    p_entity_type := 'wd_overspeed',
    p_summary     := 'Import překročení rychlosti z Webdispečinku',
    p_user_id     := auth.uid()
  );

  RETURN jsonb_build_object('total', v_total, 'updated', v_updated, 'inserted', v_total - v_updated);
END;
$$;

REVOKE ALL ON FUNCTION public.wd_upsert_overspeed_audited(jsonb) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.wd_upsert_overspeed_audited(jsonb) TO service_role;
