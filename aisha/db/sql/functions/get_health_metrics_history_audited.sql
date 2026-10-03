-- Function: public.get_health_metrics_history_audited
-- Description: Get health metrics history (time series) for an registration
-- Security: SECURITY DEFINER with audit logging
-- sensitive data: Yes - reads health metrics data

CREATE OR REPLACE FUNCTION public.get_health_metrics_history_audited(
  p_study_registration_id UUID,
  p_metric_name TEXT DEFAULT NULL,
  p_limit INTEGER DEFAULT 100
)
RETURNS TABLE (
  id UUID,
  measured_at TIMESTAMPTZ,
  physical_state INTEGER,
  mental_state INTEGER,
  energy_level INTEGER,
  stress_level INTEGER,
  sleep_quality INTEGER,
  pain_level INTEGER,
  weight_kg NUMERIC,
  source TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
SET search_path = public
AS $$
DECLARE
  v_user_id UUID;
BEGIN
  -- Get registration owner
  SELECT user_id INTO v_user_id
  FROM study_registrations
  WHERE id = p_study_registration_id;

  -- Authorization
  IF v_user_id != auth.uid() AND NOT is_admin_or_staff(auth.uid()) THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;

  -- Audit
  INSERT INTO audit_journal (user_id, action, metadata)
  VALUES (
    auth.uid(),
    'HEALTH_METRICS_HISTORY_VIEW',
    jsonb_build_object(
      'area', 'health',
      'severity', 'info',
      'registration_id', p_study_registration_id,
      'limit', p_limit
    )
  );

  RETURN QUERY
  SELECT 
    hm.id,
    hm.measured_at,
    hm.physical_state,
    hm.mental_state,
    hm.energy_level,
    hm.stress_level,
    hm.sleep_quality,
    hm.pain_level,
    hm.weight_kg,
    hm.source
  FROM health_metrics hm
  WHERE hm.study_registration_id = p_study_registration_id
  ORDER BY hm.measured_at DESC
  LIMIT p_limit;
END;
$$;

REVOKE ALL ON FUNCTION public.get_health_metrics_history_audited(uuid, text, integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_health_metrics_history_audited(uuid, text, integer) FROM anon;
GRANT EXECUTE ON FUNCTION public.get_health_metrics_history_audited(uuid, text, integer) TO authenticated;

COMMENT ON FUNCTION public.get_health_metrics_history_audited(uuid, text, integer) IS 'Get health metrics history for an registration';
