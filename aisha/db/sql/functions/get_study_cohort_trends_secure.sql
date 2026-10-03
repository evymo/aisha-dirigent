-- Function: public.get_study_cohort_trends_secure
-- Arguments: p_study_id uuid
-- Security: See function definition below.
-- Extracted: 2026-01-08T18:27:32+01:00

CREATE OR REPLACE FUNCTION public.get_study_cohort_trends_secure(p_study_id uuid DEFAULT NULL::uuid)
 RETURNS TABLE(study_id uuid, week_start date, avg_pain_level numeric, avg_energy_level numeric, avg_mood_level numeric, avg_sleep_quality numeric, participant_count bigint)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  -- Only admins or staff can access cohort trends
  IF NOT is_admin_or_staff() THEN
    RAISE EXCEPTION 'Access denied: admin or staff role required';
  END IF;
  
  -- Audit log
  INSERT INTO audit_journal (user_id, action_type, area, entity_type, summary, severity, details)
  VALUES (auth.uid(), 'read', 'study', 'study_cohort_trends', 'User accessed cohort trends', 'medium',
    jsonb_build_object('study_id', p_study_id));

  RETURN QUERY
  SELECT
    sct.study_id,
    sct.week_start,
    sct.avg_pain AS avg_pain_level,
    sct.avg_energy AS avg_energy_level,
    sct.avg_mood AS avg_mood_level,
    sct.avg_sleep_quality,
    sct.participant_count
  FROM public.study_cohort_trends sct
  WHERE p_study_id IS NULL OR sct.study_id = p_study_id
  ORDER BY sct.study_id, sct.week_start;
END;
$function$
;

-- Permissions
REVOKE ALL ON FUNCTION public.get_study_cohort_trends_secure(p_study_id uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_study_cohort_trends_secure(p_study_id uuid) TO authenticated;
