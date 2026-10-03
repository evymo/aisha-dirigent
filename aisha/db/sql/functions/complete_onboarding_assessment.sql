-- Function: public.complete_onboarding_assessment
-- Arguments: none
-- Description: Creates a completed onboarding assessment for the current user.
--              Used when user completes the reInvented Immunology onboarding questionnaire.
--              If an existing in_progress assessment exists, updates it to completed.
-- Security: SECURITY DEFINER, authenticated only

CREATE OR REPLACE FUNCTION public.complete_onboarding_assessment()
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_assessment_id uuid;
  v_user_id uuid;
BEGIN
  v_user_id := auth.uid();
  
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;
  
  -- Check for existing onboarding assessment
  SELECT id INTO v_assessment_id
  FROM public.operational_assessments
  WHERE user_id = v_user_id
    AND assessment_type = 'onboarding'
  ORDER BY created_at DESC
  LIMIT 1;
  
  IF v_assessment_id IS NOT NULL THEN
    -- Update existing to completed
    UPDATE public.operational_assessments
    SET status = 'completed',
        updated_at = now()
    WHERE id = v_assessment_id;
  ELSE
    -- Create new completed assessment
    INSERT INTO public.operational_assessments (user_id, assessment_type, status)
    VALUES (v_user_id, 'onboarding', 'completed')
    RETURNING id INTO v_assessment_id;
  END IF;
  
  -- Audit log
  PERFORM public.write_audit_journal(
      p_action_type := 'update'::journal_action_type,
      p_area := 'member'::journal_area,
      p_details := NULL,
      p_entity_id := 'Onboarding questionnaire completed',
      p_entity_type := 'operational_assessment',
      p_old_values := jsonb_build_object('assessment_type', 'onboarding', 'status', 'completed'),
      p_severity := 'info'::journal_severity,
      p_summary := v_assessment_id::text,
    p_user_id := v_user_id
  );
  
  RETURN v_assessment_id;
END;
$function$
;

-- Permissions
REVOKE ALL ON FUNCTION public.complete_onboarding_assessment() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.complete_onboarding_assessment() TO authenticated;
