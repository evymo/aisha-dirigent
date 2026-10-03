-- Function: public.get_study_cohort_lab_trends_secure
-- Arguments: p_study_id uuid
-- Security: See function definition below.
-- Extracted: 2026-01-08T18:27:31+01:00

CREATE OR REPLACE FUNCTION public.get_study_cohort_lab_trends_secure(p_study_id uuid DEFAULT NULL::uuid)
 RETURNS TABLE(study_id uuid, month date, avg_crp numeric, avg_vitamin_d numeric, avg_glucose numeric, avg_cholesterol numeric, sample_count bigint)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  -- Only admins can access lab trends (most sensitive operational data)
  IF NOT has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'Access denied: admin role required';
  END IF;
  
  -- Audit log with high severity
  INSERT INTO audit_journal (user_id, action_type, area, entity_type, summary, severity, details)
  VALUES (auth.uid(), 'read', 'study', 'study_cohort_lab_trends', 'Admin accessed lab trends', 'high',
    jsonb_build_object('study_id', p_study_id));

  RETURN QUERY
  SELECT
    slt.study_id,
    slt.month_start AS month,
    slt.avg_crp,
    slt.avg_vitamin_d,
    slt.avg_glucose,
    slt.avg_cholesterol,
    slt.lab_count AS sample_count
  FROM public.study_cohort_lab_trends slt
  WHERE p_study_id IS NULL OR slt.study_id = p_study_id
  ORDER BY slt.month_start;
END;
$function$
;

-- Permissions
REVOKE ALL ON FUNCTION public.get_study_cohort_lab_trends_secure(p_study_id uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_study_cohort_lab_trends_secure(p_study_id uuid) TO authenticated;
