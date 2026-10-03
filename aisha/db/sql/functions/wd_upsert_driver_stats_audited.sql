-- ============================================================================
-- Source of Truth: wd_upsert_driver_stats_audited
-- Popis: Batch upsert statistiky řidičů z _getStaDrivers. Jeden snapshot per
--        řidič — upsert podle wd_driver_id (poslední okno přepisuje).
-- Bezpečnost: SECURITY DEFINER + REVOKE/GRANT + fail-closed auth guard.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.wd_upsert_driver_stats_audited(
  p_stats jsonb
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

  IF p_stats IS NULL OR jsonb_typeof(p_stats) <> 'array' THEN
    RAISE EXCEPTION 'p_stats must be a jsonb array';
  END IF;

  SELECT COALESCE(jsonb_agg(deduped.item), '[]'::jsonb) INTO v_batch
  FROM (
    SELECT DISTINCT ON ((item->>'wd_driver_id')::integer) item
    FROM jsonb_array_elements(p_stats) AS item
    WHERE item->>'wd_driver_id' IS NOT NULL
  ) AS deduped;

  v_total := jsonb_array_length(v_batch);

  SELECT count(*) INTO v_updated
  FROM public.wd_driver_stats s
  JOIN jsonb_array_elements(v_batch) AS item
    ON s.wd_driver_id = (item->>'wd_driver_id')::integer;

  INSERT INTO public.wd_driver_stats (
    wd_driver_id, period_from, period_to, total_km, service_km, private_km,
    driving_seconds, driving_service_seconds, driving_private_seconds,
    driving_service_day_seconds, driving_service_night_seconds, commute_count,
    raw_data, last_import_at, updated_at
  )
  SELECT
    (item->>'wd_driver_id')::integer,
    NULLIF(item->>'period_from', '')::date,
    NULLIF(item->>'period_to', '')::date,
    NULLIF(item->>'total_km', '')::numeric,
    NULLIF(item->>'service_km', '')::numeric,
    NULLIF(item->>'private_km', '')::numeric,
    NULLIF(item->>'driving_seconds', '')::integer,
    NULLIF(item->>'driving_service_seconds', '')::integer,
    NULLIF(item->>'driving_private_seconds', '')::integer,
    NULLIF(item->>'driving_service_day_seconds', '')::integer,
    NULLIF(item->>'driving_service_night_seconds', '')::integer,
    NULLIF(item->>'commute_count', '')::integer,
    item->'raw',
    now(),
    now()
  FROM jsonb_array_elements(v_batch) AS item
  ON CONFLICT (wd_driver_id) DO UPDATE SET
    period_from                   = EXCLUDED.period_from,
    period_to                     = EXCLUDED.period_to,
    total_km                      = EXCLUDED.total_km,
    service_km                    = EXCLUDED.service_km,
    private_km                    = EXCLUDED.private_km,
    driving_seconds               = EXCLUDED.driving_seconds,
    driving_service_seconds       = EXCLUDED.driving_service_seconds,
    driving_private_seconds       = EXCLUDED.driving_private_seconds,
    driving_service_day_seconds   = EXCLUDED.driving_service_day_seconds,
    driving_service_night_seconds = EXCLUDED.driving_service_night_seconds,
    commute_count                 = EXCLUDED.commute_count,
    raw_data                      = EXCLUDED.raw_data,
    last_import_at                = now(),
    updated_at                    = now();

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
      'table', 'wd_driver_stats',
      'total', v_total,
      'updated', v_updated,
      'inserted', v_total - v_updated,
      'via_service_role', v_is_service
    ),
    p_entity_type := 'wd_driver_stats',
    p_summary     := 'Import statistik řidičů z Webdispečinku',
    p_user_id     := auth.uid()
  );

  RETURN jsonb_build_object('total', v_total, 'updated', v_updated, 'inserted', v_total - v_updated);
END;
$$;

REVOKE ALL ON FUNCTION public.wd_upsert_driver_stats_audited(jsonb) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.wd_upsert_driver_stats_audited(jsonb) TO service_role;
