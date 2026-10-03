-- Function: public.create_operational_assessment
-- Arguments: p_assessment_type text DEFAULT 'onboarding'::text
-- Security: SECURITY DEFINER
-- Source: Extracted from local DB (source-of-truth sync)

CREATE OR REPLACE FUNCTION public.create_operational_assessment(p_assessment_type text DEFAULT 'onboarding'::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_assessment_id uuid;
BEGIN
  INSERT INTO public.operational_assessments (user_id, assessment_type, status)
  VALUES (auth.uid(), p_assessment_type, 'in_progress')
  RETURNING id INTO v_assessment_id;
  
  -- Audit log
  PERFORM public.write_audit_journal(
      p_action_type := 'create'::journal_action_type,
      p_area := 'member'::journal_area,
      p_details := NULL,
      p_entity_id := 'Operational assessment started',
      p_entity_type := 'operational_assessment',
      p_old_values := jsonb_build_object('assessment_type', p_assessment_type),
      p_severity := 'info'::journal_severity,
      p_summary := v_assessment_id::text,
    p_user_id := auth.uid()
  );
  
  RETURN v_assessment_id;
END;
$function$;

REVOKE ALL ON FUNCTION public.create_operational_assessment(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.create_operational_assessment(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.create_operational_assessment(text) TO service_role;
