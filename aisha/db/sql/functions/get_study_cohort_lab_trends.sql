-- Function: public.get_study_cohort_lab_trends
-- Arguments: p_study_id uuid
-- Security: See function definition below.
-- Extracted: 2026-01-08T18:27:31+01:00

CREATE OR REPLACE FUNCTION public.get_study_cohort_lab_trends(p_study_id uuid)
 RETURNS TABLE(study_id uuid, month_start date, participant_count bigint, lab_count bigint, avg_glucose numeric, avg_cholesterol numeric, avg_hemoglobin numeric, avg_crp numeric, avg_vitamin_d numeric)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_participant_count bigint;
BEGIN
  -- Check if user is admin/staff OR an approved consultant for the study
  IF NOT (
    is_admin_or_staff(auth.uid()) OR 
    EXISTS (
      SELECT 1 FROM study_consultants sc
      JOIN partner_profiles pp ON pp.id = sc.partner_id
      WHERE sc.study_id = p_study_id
        AND pp.user_id = auth.uid()
        AND sc.status = 'approved'
    )
  ) THEN
    RAISE EXCEPTION 'Access denied: insufficient permissions';
  END IF;

  -- Count total participants for compliance Safe Harbor compliance
  SELECT COUNT(DISTINCT se.user_id) INTO v_participant_count
  FROM study_registrations se
  WHERE se.study_id = p_study_id
    AND se.status IN ('active', 'enrolled', 'completed');
  
  -- Enforce minimum cohort size (compliance Safe Harbor requires >= 5)
  IF v_participant_count < 5 THEN
    -- Log the attempt in audit journal with correct enum: 'warning' instead of 'warn'
    INSERT INTO audit_journal (
      user_id, action_type, area, severity, entity_type, entity_id,
      summary, details
    ) VALUES (
      auth.uid(), 'view', 'research', 'warning',
      'study', p_study_id::text,
      'Access denied: cohort size below compliance Safe Harbor threshold',
      jsonb_build_object('participant_count', v_participant_count, 'threshold', 5, 'function', 'get_study_cohort_lab_trends')
    );
    
    RAISE EXCEPTION 'Cohort size too small for aggregate statistics (n=%). Minimum 5 participants required for compliance.', v_participant_count;
  END IF;

  -- Return trends, also filtering out individual months with small participant counts
  RETURN QUERY
  SELECT sclt.*
  FROM study_cohort_lab_trends sclt
  WHERE sclt.study_id = p_study_id
    AND sclt.participant_count >= 5  -- Suppress small cells
  ORDER BY sclt.month_start;
END;
$function$
;

-- Permissions
REVOKE ALL ON FUNCTION public.get_study_cohort_lab_trends(p_study_id uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_study_cohort_lab_trends(p_study_id uuid) TO authenticated;
