-- Function: public.get_baseline_comparison_audited
-- Description: Get baseline vs current comparison for all health metrics
-- Security: SECURITY DEFINER with audit logging
-- sensitive data: Yes - reads health metrics data

CREATE OR REPLACE FUNCTION public.get_baseline_comparison_audited(
  p_study_registration_id UUID
)
RETURNS TABLE (
  metric_name TEXT,
  baseline_value NUMERIC,
  baseline_measured_at TIMESTAMPTZ,
  current_value NUMERIC,
  current_measured_at TIMESTAMPTZ,
  change_absolute NUMERIC,
  change_percent NUMERIC,
  trend TEXT,
  measurements_count BIGINT
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

  -- Authorization: own data or admin/staff
  IF v_user_id != auth.uid() AND NOT is_admin_or_staff(auth.uid()) THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;

  -- Audit log
  INSERT INTO audit_journal (user_id, action, metadata)
  VALUES (
    auth.uid(),
    'BASELINE_COMPARISON_VIEW',
    jsonb_build_object(
      'area', 'health',
      'severity', 'info',
      'registration_id', p_study_registration_id,
      'target_user_id', v_user_id
    )
  );

  -- Return comparison for each metric
  RETURN QUERY
  WITH baseline AS (
    SELECT
      hm.physical_state,
      hm.mental_state,
      hm.energy_level,
      hm.stress_level,
      hm.weight_kg,
      hm.pain_level,
      hm.measured_at
    FROM health_metrics hm
    WHERE hm.study_registration_id = p_study_registration_id
    AND hm.source = 'registration'
    ORDER BY hm.measured_at ASC
    LIMIT 1
  ),
  latest AS (
    SELECT
      hm.physical_state,
      hm.mental_state,
      hm.energy_level,
      hm.stress_level,
      hm.weight_kg,
      hm.pain_level,
      hm.measured_at
    FROM health_metrics hm
    WHERE hm.study_registration_id = p_study_registration_id
    AND hm.source != 'registration'
    ORDER BY hm.measured_at DESC
    LIMIT 1
  ),
  counts AS (
    SELECT COUNT(*) as total
    FROM health_metrics
    WHERE study_registration_id = p_study_registration_id
  )
  -- Physical state
  SELECT 
    'physical_state'::TEXT,
    b.physical_state::NUMERIC,
    b.measured_at,
    l.physical_state::NUMERIC,
    l.measured_at,
    (l.physical_state - b.physical_state)::NUMERIC,
    CASE WHEN b.physical_state > 0 
      THEN ROUND(((l.physical_state - b.physical_state)::NUMERIC / b.physical_state) * 100, 1)
      ELSE NULL 
    END,
    CASE 
      WHEN l.physical_state > b.physical_state THEN 'improving'
      WHEN l.physical_state = b.physical_state THEN 'stable'
      ELSE 'declining'
    END,
    c.total
  FROM baseline b, latest l, counts c
  WHERE b.physical_state IS NOT NULL AND l.physical_state IS NOT NULL

  UNION ALL
  
  -- Mental state
  SELECT 
    'mental_state'::TEXT,
    b.mental_state::NUMERIC,
    b.measured_at,
    l.mental_state::NUMERIC,
    l.measured_at,
    (l.mental_state - b.mental_state)::NUMERIC,
    CASE WHEN b.mental_state > 0 
      THEN ROUND(((l.mental_state - b.mental_state)::NUMERIC / b.mental_state) * 100, 1)
      ELSE NULL 
    END,
    CASE 
      WHEN l.mental_state > b.mental_state THEN 'improving'
      WHEN l.mental_state = b.mental_state THEN 'stable'
      ELSE 'declining'
    END,
    c.total
  FROM baseline b, latest l, counts c
  WHERE b.mental_state IS NOT NULL AND l.mental_state IS NOT NULL

  UNION ALL
  
  -- Energy level
  SELECT 
    'energy_level'::TEXT,
    b.energy_level::NUMERIC,
    b.measured_at,
    l.energy_level::NUMERIC,
    l.measured_at,
    (l.energy_level - b.energy_level)::NUMERIC,
    CASE WHEN b.energy_level > 0 
      THEN ROUND(((l.energy_level - b.energy_level)::NUMERIC / b.energy_level) * 100, 1)
      ELSE NULL 
    END,
    CASE 
      WHEN l.energy_level > b.energy_level THEN 'improving'
      WHEN l.energy_level = b.energy_level THEN 'stable'
      ELSE 'declining'
    END,
    c.total
  FROM baseline b, latest l, counts c
  WHERE b.energy_level IS NOT NULL AND l.energy_level IS NOT NULL

  UNION ALL
  
  -- Stress level (inverse - lower is better)
  SELECT 
    'stress_level'::TEXT,
    b.stress_level::NUMERIC,
    b.measured_at,
    l.stress_level::NUMERIC,
    l.measured_at,
    (l.stress_level - b.stress_level)::NUMERIC,
    CASE WHEN b.stress_level > 0 
      THEN ROUND(((l.stress_level - b.stress_level)::NUMERIC / b.stress_level) * 100, 1)
      ELSE NULL 
    END,
    CASE 
      WHEN l.stress_level < b.stress_level THEN 'improving'  -- Lower stress = better
      WHEN l.stress_level = b.stress_level THEN 'stable'
      ELSE 'declining'
    END,
    c.total
  FROM baseline b, latest l, counts c
  WHERE b.stress_level IS NOT NULL AND l.stress_level IS NOT NULL

  UNION ALL
  
  -- Weight
  SELECT 
    'weight_kg'::TEXT,
    b.weight_kg::NUMERIC,
    b.measured_at,
    l.weight_kg::NUMERIC,
    l.measured_at,
    (l.weight_kg - b.weight_kg)::NUMERIC,
    CASE WHEN b.weight_kg > 0 
      THEN ROUND(((l.weight_kg - b.weight_kg)::NUMERIC / b.weight_kg) * 100, 1)
      ELSE NULL 
    END,
    'neutral'::TEXT,  -- Weight change is context-dependent
    c.total
  FROM baseline b, latest l, counts c
  WHERE b.weight_kg IS NOT NULL AND l.weight_kg IS NOT NULL

  UNION ALL
  
  -- Pain level (inverse - lower is better)
  SELECT 
    'pain_level'::TEXT,
    b.pain_level::NUMERIC,
    b.measured_at,
    l.pain_level::NUMERIC,
    l.measured_at,
    (l.pain_level - b.pain_level)::NUMERIC,
    CASE WHEN b.pain_level > 0 
      THEN ROUND(((l.pain_level - b.pain_level)::NUMERIC / b.pain_level) * 100, 1)
      ELSE NULL 
    END,
    CASE 
      WHEN l.pain_level < b.pain_level THEN 'improving'  -- Less pain = better
      WHEN l.pain_level = b.pain_level THEN 'stable'
      ELSE 'declining'
    END,
    c.total
  FROM baseline b, latest l, counts c
  WHERE b.pain_level IS NOT NULL AND l.pain_level IS NOT NULL;
END;
$$;

REVOKE ALL ON FUNCTION public.get_baseline_comparison_audited(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_baseline_comparison_audited(uuid) TO authenticated;

COMMENT ON FUNCTION public.get_baseline_comparison_audited(uuid) IS 'Get baseline vs current comparison for all health metrics';
