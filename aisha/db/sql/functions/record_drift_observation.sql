-- ============================================================================
-- Source of Truth: record_drift_observation
-- Popis: Insertuje novou drift observation. Idempotent v 5min buckets — pokud
--        existuje unresolved row se stejným (app_uuid, drift_kind) v posledních
--        5 minutách, updatne `observation_count` a vrátí existující ID
--        (nedělá nový insert). Drift kind validovaný proti CHECK constraint.
-- Volá: WF_DRIFT_OBSERVER (n8n cron 10min) na výsledcích z coolify-drift-check.mjs
-- Auth: service_role nebo admin/staff
-- ============================================================================

CREATE OR REPLACE FUNCTION public.record_drift_observation(
  p_app_uuid      text,
  p_app_name      text,
  p_drift_kind    text,
  p_desired_value jsonb,
  p_actual_value  jsonb,
  p_risk_level    text,
  p_metadata      jsonb DEFAULT '{}'::jsonb
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_existing_id uuid;
  v_new_id      uuid;
  v_is_service  boolean;
BEGIN
  -- Authorization: service_role nebo admin
  v_is_service := public.is_service_role();
  IF NOT v_is_service AND NOT public.is_admin_or_staff() THEN
    RAISE EXCEPTION 'Unauthorized: admin, staff, or service_role required' USING ERRCODE = '22023';
  END IF;

  -- Validate inputs
  IF p_app_uuid IS NULL OR p_app_uuid = '' THEN
    RAISE EXCEPTION 'app_uuid required' USING ERRCODE = '22023';
  END IF;
  IF p_risk_level NOT IN ('low','medium','high','critical') THEN
    RAISE EXCEPTION 'Invalid risk_level: %', p_risk_level USING ERRCODE = '22023';
  END IF;

  -- Dedup: existing unresolved row in last 5 min?
  SELECT id INTO v_existing_id
  FROM public.drift_state
  WHERE app_uuid = p_app_uuid
    AND drift_kind = p_drift_kind
    AND observed_at > now() - interval '5 minutes'
    AND resolved_at IS NULL
  ORDER BY observed_at DESC
  LIMIT 1;

  IF v_existing_id IS NOT NULL THEN
    UPDATE public.drift_state
    SET observation_count = observation_count + 1,
        actual_value = p_actual_value,    -- update s nejnovější hodnotou
        observed_at = now(),
        metadata = metadata || p_metadata
    WHERE id = v_existing_id;
    RETURN v_existing_id;
  END IF;

  -- New observation
  INSERT INTO public.drift_state (
    app_uuid, app_name, drift_kind,
    desired_value, actual_value, risk_level,
    remediation, metadata
  )
  VALUES (
    p_app_uuid, p_app_name, p_drift_kind,
    p_desired_value, p_actual_value, p_risk_level,
    'pending', p_metadata
  )
  RETURNING id INTO v_new_id;

  RETURN v_new_id;
END;
$$;

REVOKE ALL ON FUNCTION public.record_drift_observation(text, text, text, jsonb, jsonb, text, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.record_drift_observation(text, text, text, jsonb, jsonb, text, jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.record_drift_observation(text, text, text, jsonb, jsonb, text, jsonb) TO service_role;
