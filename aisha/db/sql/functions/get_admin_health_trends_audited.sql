-- Function: get_admin_health_trends_audited
-- Purpose: Aggregated health trends for admin dashboard with period navigation
--          and multi-dimensional filtering (study, age range, gender, check-in type).
-- Security: SECURITY DEFINER, admin/staff only
-- Audit: Yes (health_check_ins read)

CREATE OR REPLACE FUNCTION public.get_admin_health_trends_audited(
  p_age_max integer DEFAULT NULL,
  p_age_min integer DEFAULT NULL,
  p_check_in_type text DEFAULT NULL,
  p_end_date date DEFAULT CURRENT_DATE,
  p_gender text DEFAULT NULL,
  p_granularity text DEFAULT 'monthly',
  p_start_date date DEFAULT (CURRENT_DATE - INTERVAL '12 months')::date,
  p_study_id uuid DEFAULT NULL
)
RETURNS TABLE(
  avg_energy numeric,
  avg_mood numeric,
  avg_pain numeric,
  avg_sleep numeric,
  check_in_count bigint,
  period_start date,
  unique_users bigint
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_ref_date date := CURRENT_DATE;
BEGIN
  -- Authorization check
  IF NOT public.is_admin_or_staff() THEN
    RAISE EXCEPTION 'Access denied: admin or staff role required';
  END IF;

  -- Validate granularity
  IF p_granularity NOT IN ('weekly', 'monthly') THEN
    RAISE EXCEPTION 'Invalid granularity: must be weekly or monthly' USING ERRCODE = '22023';
  END IF;

  -- Validate check_in_type if provided
  IF p_check_in_type IS NOT NULL AND p_check_in_type NOT IN ('morning', 'evening', 'weekly', 'monthly') THEN
    RAISE EXCEPTION 'Invalid check_in_type: must be morning, evening, weekly, or monthly' USING ERRCODE = '22023';
  END IF;

  -- Validate age range if provided
  IF p_age_min IS NOT NULL AND p_age_min < 0 THEN
    RAISE EXCEPTION 'Invalid age_min: must be non-negative' USING ERRCODE = '22023';
  END IF;
  IF p_age_max IS NOT NULL AND p_age_max < 0 THEN
    RAISE EXCEPTION 'Invalid age_max: must be non-negative' USING ERRCODE = '22023';
  END IF;
  IF p_age_min IS NOT NULL AND p_age_max IS NOT NULL AND p_age_min > p_age_max THEN
    RAISE EXCEPTION 'Invalid age range: age_min must be <= age_max' USING ERRCODE = '22023';
  END IF;

  -- Audit log
  BEGIN
    PERFORM public.write_audit_journal(
      p_action_type := 'read'::journal_action_type,
      p_area := 'admin'::journal_area,
      p_entity_id := NULL,
      p_entity_type := 'health_check_ins',
      p_severity := 'info'::journal_severity,
      p_summary := 'Admin viewed health trends',
    p_user_id := auth.uid()
  );
  EXCEPTION WHEN undefined_function OR invalid_parameter_value THEN
    INSERT INTO public.audit_journal (user_id, action, entity_type, metadata, created_at)
    VALUES (
      auth.uid(),
      'read',
      'health_check_ins',
      jsonb_build_object(
        'area', 'admin',
        'summary', 'Admin viewed health trends',
        'granularity', p_granularity,
        'start_date', p_start_date::text,
        'end_date', p_end_date::text,
        'filters', jsonb_build_object(
          'study_id', p_study_id,
          'age_min', p_age_min,
          'age_max', p_age_max,
          'gender', p_gender,
          'check_in_type', p_check_in_type
        )
      ),
      now()
    );
  END;

  RETURN QUERY
  SELECT
    ROUND(AVG(hc.energy_level) FILTER (WHERE hc.energy_level IS NOT NULL), 2) AS avg_energy,
    ROUND(AVG(hc.mood_level) FILTER (WHERE hc.mood_level IS NOT NULL), 2) AS avg_mood,
    ROUND(AVG(hc.pain_level) FILTER (WHERE hc.pain_level IS NOT NULL), 2) AS avg_pain,
    ROUND(AVG(hc.sleep_quality) FILTER (WHERE hc.sleep_quality IS NOT NULL), 2) AS avg_sleep,
    COUNT(*)::bigint AS check_in_count,
    CASE
      WHEN p_granularity = 'monthly' THEN date_trunc('month', hc.check_in_date)::date
      ELSE date_trunc('week', hc.check_in_date)::date
    END AS period_start,
    COUNT(DISTINCT hc.user_id)::bigint AS unique_users
  FROM public.health_check_ins hc
  -- JOIN profiles only when demographic filters are active
  LEFT JOIN public.profiles p
    ON hc.user_id = p.id
    AND (p_age_min IS NOT NULL OR p_age_max IS NOT NULL OR p_gender IS NOT NULL)
  WHERE hc.check_in_date >= p_start_date
    AND hc.check_in_date <= p_end_date
    -- Study filter
    AND (p_study_id IS NULL OR hc.study_id = p_study_id)
    -- Check-in type filter
    AND (p_check_in_type IS NULL OR hc.check_in_type::text = p_check_in_type)
    -- Gender filter
    AND (p_gender IS NULL OR p.gender = p_gender)
    -- Age range filter (compute age from date_of_birth)
    AND (p_age_min IS NULL OR (
      p.date_of_birth IS NOT NULL
      AND EXTRACT(YEAR FROM age(v_ref_date, p.date_of_birth)) >= p_age_min
    ))
    AND (p_age_max IS NULL OR (
      p.date_of_birth IS NOT NULL
      AND EXTRACT(YEAR FROM age(v_ref_date, p.date_of_birth)) <= p_age_max
    ))
  GROUP BY period_start
  ORDER BY period_start ASC;
END;
$$;

REVOKE ALL ON FUNCTION public.get_admin_health_trends_audited(
  integer, integer, text, date, text, text, date, uuid
) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_admin_health_trends_audited(
  integer, integer, text, date, text, text, date, uuid
) TO authenticated;
