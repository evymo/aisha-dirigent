-- ============================================================================
-- Source of Truth: wd_upsert_worktime_audited
-- Popis: Batch upsert výkonů řidičů podle tachografu z _getDriverWorkTacho.
--        Upsert podle (wd_driver_id, work_date, car_identifikator) —
--        tacho se zpětně dopočítává, opakovaný import stejného okna aktualizuje.
-- Bezpečnost: SECURITY DEFINER + REVOKE/GRANT + fail-closed auth guard.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.wd_upsert_worktime_audited(
  p_worktime jsonb
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
  -- Authorization (FIRST, before any data access). is_service_role() COALESCEs
  -- to false → guard fails CLOSED without a role claim.
  IF NOT v_is_service AND NOT public.is_admin_or_staff() THEN
    RAISE EXCEPTION 'Unauthorized: admin, staff, or service_role required';
  END IF;

  IF p_worktime IS NULL OR jsonb_typeof(p_worktime) <> 'array' THEN
    RAISE EXCEPTION 'p_worktime must be a jsonb array';
  END IF;

  -- Dedup podle (wd_driver_id, work_date, car_identifikator) — ON CONFLICT nesmí
  -- zasáhnout stejný řádek v jedné dávce dvakrát.
  SELECT COALESCE(jsonb_agg(deduped.item), '[]'::jsonb) INTO v_batch
  FROM (
    SELECT DISTINCT ON (
      (item->>'wd_driver_id')::integer,
      (item->>'work_date')::date,
      COALESCE(item->>'car_identifikator', '')
    ) item
    FROM jsonb_array_elements(p_worktime) AS item
    WHERE item->>'wd_driver_id' IS NOT NULL
      AND item->>'work_date' IS NOT NULL
  ) AS deduped;

  v_total := jsonb_array_length(v_batch);

  SELECT count(*) INTO v_updated
  FROM public.wd_worktime w
  JOIN jsonb_array_elements(v_batch) AS item
    ON w.wd_driver_id = (item->>'wd_driver_id')::integer
   AND w.work_date = (item->>'work_date')::date
   AND w.car_identifikator = COALESCE(item->>'car_identifikator', '');

  INSERT INTO public.wd_worktime (
    wd_driver_id, car_identifikator, work_date, day_type, work_from, work_to,
    total_drive_seconds, total_work_seconds, total_rest_seconds, total_standby_seconds,
    night_drive_seconds, night_work_seconds, night_rest_seconds, night_standby_seconds,
    distance_km, absences, raw_data, last_import_at, updated_at
  )
  SELECT
    (item->>'wd_driver_id')::integer,
    COALESCE(item->>'car_identifikator', ''),
    (item->>'work_date')::date,
    NULLIF(item->>'day_type', ''),
    NULLIF(item->>'work_from', '')::time,
    NULLIF(item->>'work_to', '')::time,
    NULLIF(item->>'total_drive_seconds', '')::integer,
    NULLIF(item->>'total_work_seconds', '')::integer,
    NULLIF(item->>'total_rest_seconds', '')::integer,
    NULLIF(item->>'total_standby_seconds', '')::integer,
    NULLIF(item->>'night_drive_seconds', '')::integer,
    NULLIF(item->>'night_work_seconds', '')::integer,
    NULLIF(item->>'night_rest_seconds', '')::integer,
    NULLIF(item->>'night_standby_seconds', '')::integer,
    NULLIF(item->>'distance_km', '')::numeric,
    item->'absences',
    item->'raw',
    now(),
    now()
  FROM jsonb_array_elements(v_batch) AS item
  ON CONFLICT (wd_driver_id, work_date, car_identifikator) DO UPDATE SET
    day_type              = EXCLUDED.day_type,
    work_from             = EXCLUDED.work_from,
    work_to               = EXCLUDED.work_to,
    total_drive_seconds   = EXCLUDED.total_drive_seconds,
    total_work_seconds    = EXCLUDED.total_work_seconds,
    total_rest_seconds    = EXCLUDED.total_rest_seconds,
    total_standby_seconds = EXCLUDED.total_standby_seconds,
    night_drive_seconds   = EXCLUDED.night_drive_seconds,
    night_work_seconds    = EXCLUDED.night_work_seconds,
    night_rest_seconds    = EXCLUDED.night_rest_seconds,
    night_standby_seconds = EXCLUDED.night_standby_seconds,
    distance_km           = EXCLUDED.distance_km,
    absences              = EXCLUDED.absences,
    raw_data              = EXCLUDED.raw_data,
    last_import_at        = now(),
    updated_at            = now();

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
      'table', 'wd_worktime',
      'total', v_total,
      'updated', v_updated,
      'inserted', v_total - v_updated,
      'via_service_role', v_is_service
    ),
    p_entity_type := 'wd_worktime',
    p_summary     := 'Import výkonů řidičů z Webdispečinku',
    p_user_id     := auth.uid()
  );

  RETURN jsonb_build_object('total', v_total, 'updated', v_updated, 'inserted', v_total - v_updated);
END;
$$;

REVOKE ALL ON FUNCTION public.wd_upsert_worktime_audited(jsonb) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.wd_upsert_worktime_audited(jsonb) TO service_role;
