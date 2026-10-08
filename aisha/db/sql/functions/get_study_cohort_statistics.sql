-- Function: public.get_study_cohort_statistics
-- Arguments: p_study_id uuid
-- Security: See function definition below.
-- Extracted: 2026-01-08T18:27:31+01:00

CREATE OR REPLACE FUNCTION public.get_study_cohort_statistics(p_study_id uuid DEFAULT NULL::uuid)
 RETURNS TABLE(study_id uuid, total_participants bigint, active_participants bigint, completed_participants bigint, avg_pain_level numeric, avg_energy_level numeric, avg_mood_level numeric, avg_sleep_quality numeric, avg_sleep_hours numeric, avg_crp numeric, avg_vitamin_d numeric, avg_glucose numeric, total_check_ins bigint, total_lab_results bigint, total_dosing_logs bigint)
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
    (p_study_id IS NOT NULL AND EXISTS (
      SELECT 1 FROM study_consultants sc
      JOIN partner_profiles pp ON pp.id = sc.partner_id
      WHERE sc.study_id = p_study_id
        AND pp.user_id = auth.uid()
        AND sc.status = 'approved'
    ))
  ) THEN
    RAISE EXCEPTION 'Access denied: insufficient permissions';
  END IF;

  -- Count participants for compliance Safe Harbor compliance
  IF p_study_id IS NOT NULL THEN
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
        jsonb_build_object('participant_count', v_participant_count, 'threshold', 5)
      );
      
      RAISE EXCEPTION 'Cohort size too small for aggregate statistics (n=%). Minimum 5 participants required for compliance.', v_participant_count;
    END IF;
  END IF;

  RETURN QUERY
  SELECT scs.*
  FROM study_cohort_statistics scs
  WHERE p_study_id IS NULL OR scs.study_id = p_study_id
  ORDER BY scs.study_id;
END;
$function$
;

-- Permissions
REVOKE ALL ON FUNCTION public.get_study_cohort_statistics(p_study_id uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_study_cohort_statistics(p_study_id uuid) TO authenticated;
