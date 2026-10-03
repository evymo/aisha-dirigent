-- Function: public.save_health_metric_audited
-- Description: Save a health metric with audit logging
-- Security: SECURITY DEFINER with audit logging
-- sensitive data: Yes - writes health metrics data

CREATE OR REPLACE FUNCTION public.save_health_metric_audited(
  p_study_registration_id UUID DEFAULT NULL,
  p_physical_state INTEGER DEFAULT NULL,
  p_mental_state INTEGER DEFAULT NULL,
  p_energy_level INTEGER DEFAULT NULL,
  p_stress_level INTEGER DEFAULT NULL,
  p_sleep_quality INTEGER DEFAULT NULL,
  p_pain_level INTEGER DEFAULT NULL,
  p_weight_kg NUMERIC DEFAULT NULL,
  p_height_cm NUMERIC DEFAULT NULL,
  p_source TEXT DEFAULT 'manual',
  p_source_id UUID DEFAULT NULL,
  p_measured_at TIMESTAMPTZ DEFAULT NOW(),
  p_notes TEXT DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
SET search_path = public
AS $$
DECLARE
  v_metric_id UUID;
BEGIN
  -- Insert metric
  INSERT INTO health_metrics (
    user_id,
    study_registration_id,
    measured_at,
    physical_state,
    mental_state,
    energy_level,
    stress_level,
    sleep_quality,
    pain_level,
    weight_kg,
    height_cm,
    source,
    source_id,
    notes
  ) VALUES (
    auth.uid(),
    p_study_registration_id,
    p_measured_at,
    p_physical_state,
    p_mental_state,
    p_energy_level,
    p_stress_level,
    p_sleep_quality,
    p_pain_level,
    p_weight_kg,
    p_height_cm,
    p_source,
    p_source_id,
    p_notes
  )
  RETURNING id INTO v_metric_id;

  -- Audit log
  INSERT INTO audit_journal (user_id, action, metadata)
  VALUES (
    auth.uid(),
    'HEALTH_METRIC_CREATED',
    jsonb_build_object(
      'area', 'health',
      'severity', 'info',
      'metric_id', v_metric_id,
      'source', p_source,
      'registration_id', p_study_registration_id
    )
  );

  RETURN v_metric_id;
END;
$$;

REVOKE ALL ON FUNCTION public.save_health_metric_audited(uuid, integer, integer, integer, integer, integer, integer, numeric, numeric, text, uuid, timestamptz, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.save_health_metric_audited(uuid, integer, integer, integer, integer, integer, integer, numeric, numeric, text, uuid, timestamptz, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.save_health_metric_audited(uuid, integer, integer, integer, integer, integer, integer, numeric, numeric, text, uuid, timestamptz, text) TO authenticated;

COMMENT ON FUNCTION public.save_health_metric_audited(uuid, integer, integer, integer, integer, integer, integer, numeric, numeric, text, uuid, timestamptz, text) IS 'Save a health metric with audit logging';
