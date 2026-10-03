-- Function: public.complete_operational_assessment
-- Arguments: p_assessment_id uuid, p_overall_score numeric, p_interpretation text, p_alert_flags text[], p_has_critical_flags boolean
-- Security: SECURITY DEFINER
-- Source: Extracted from local DB (source-of-truth sync)

CREATE OR REPLACE FUNCTION public.complete_operational_assessment(p_assessment_id uuid, p_overall_score numeric, p_interpretation text, p_alert_flags text[], p_has_critical_flags boolean)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_previous_score numeric;
BEGIN
  -- Verify ownership
  IF NOT EXISTS (SELECT 1 FROM public.operational_assessments WHERE id = p_assessment_id AND user_id = auth.uid()) THEN
    RAISE EXCEPTION 'Access denied';
  END IF;
  
  -- Get previous score for trend
  SELECT overall_score INTO v_previous_score
  FROM public.operational_assessments
  WHERE user_id = auth.uid()
    AND status = 'completed'
    AND id != p_assessment_id
  ORDER BY completed_at DESC
  LIMIT 1;
  
  UPDATE public.operational_assessments
  SET 
    status = 'completed',
    overall_score = p_overall_score,
    interpretation = p_interpretation,
    alert_flags = p_alert_flags,
    has_critical_flags = p_has_critical_flags,
    trend_vs_baseline = CASE WHEN v_previous_score IS NOT NULL THEN p_overall_score - v_previous_score ELSE NULL END,
    completed_at = now(),
    updated_at = now()
  WHERE id = p_assessment_id;
  
  -- Audit log
  PERFORM public.write_audit_journal(
      p_action_type := 'update'::journal_action_type,
      p_area := 'member'::journal_area,
      p_details := NULL,
      p_entity_id := 'Operational assessment completed',
      p_entity_type := 'operational_assessment',
      p_old_values := jsonb_build_object('overall_score', p_overall_score, 'interpretation', p_interpretation),
      p_severity := 'info'::journal_severity,
      p_summary := p_assessment_id::text,
    p_user_id := auth.uid()
  );
  
  RETURN true;
END;
$function$;

REVOKE ALL ON FUNCTION public.complete_operational_assessment(uuid, numeric, text, text[][], boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.complete_operational_assessment(uuid, numeric, text, text[][], boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.complete_operational_assessment(uuid, numeric, text, text[][], boolean) TO service_role;
