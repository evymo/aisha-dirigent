-- Function: public.get_study_cohort_statistics_secure
-- Arguments: (none)
-- Security: See function definition below.
-- Extracted: 2026-01-08T18:27:32+01:00

CREATE OR REPLACE FUNCTION public.get_study_cohort_statistics_secure()
 RETURNS TABLE(study_id uuid, study_name text, active_participants bigint, avg_pain_level numeric, avg_energy_level numeric, avg_mood_level numeric, avg_sleep_quality numeric, total_check_ins bigint, last_updated timestamp with time zone)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  -- Only admins or staff can access cohort statistics
  IF NOT is_admin_or_staff() THEN
    RAISE EXCEPTION 'Access denied: admin or staff role required';
  END IF;
  
  -- Audit log
  INSERT INTO audit_journal (user_id, action_type, area, entity_type, summary, severity)
  VALUES (auth.uid(), 'read', 'study', 'study_cohort_statistics', 'User accessed cohort statistics', 'medium');
  
  RETURN QUERY
  SELECT
    scs.study_id,
    COALESCE(st.name, scs.study_id::text) AS study_name,
    scs.active_participants,
    scs.avg_pain_level,
    scs.avg_energy_level,
    scs.avg_mood_level,
    scs.avg_sleep_quality,
    scs.total_check_ins,
    now() AS last_updated
  FROM public.study_cohort_statistics scs
  LEFT JOIN public.studies st ON st.id = scs.study_id
  ORDER BY scs.study_id;
END;
$function$
;

-- Permissions
REVOKE ALL ON FUNCTION public.get_study_cohort_statistics_secure() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_study_cohort_statistics_secure() TO authenticated;
