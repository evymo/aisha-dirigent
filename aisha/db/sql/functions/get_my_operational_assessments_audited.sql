-- Function: public.get_my_operational_assessments_audited
-- Arguments: p_limit integer DEFAULT 10
-- Security: SECURITY DEFINER
-- Source: Extracted from local DB (source-of-truth sync)

CREATE OR REPLACE FUNCTION public.get_my_operational_assessments_audited(p_limit integer DEFAULT 10)
 RETURNS TABLE(id uuid, assessment_type text, overall_score numeric, interpretation text, trend_vs_baseline numeric, completed_at timestamptz)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  -- Audit log using write_audit_journal
  PERFORM public.write_audit_journal(
      p_action_type := 'view'::journal_action_type,
      p_area := 'operational_data'::journal_area,
      p_details := jsonb_build_object('type', 'history', 'limit', p_limit),
      p_entity_id := NULL,
      p_entity_type := 'operational_assessment',
      p_severity := 'info'::journal_severity,
      p_summary := 'User viewed operational assessment history',
    p_user_id := auth.uid()
  );

  RETURN QUERY
  SELECT 
    ca.id,
    ca.assessment_type,
    ca.overall_score,
    ca.interpretation,
    ca.trend_vs_baseline,
    ca.completed_at
  FROM operational_assessments ca
  WHERE ca.user_id = auth.uid()
    AND ca.status = 'completed'
  ORDER BY ca.completed_at DESC
  LIMIT p_limit;
END;
$function$;

REVOKE ALL ON FUNCTION public.get_my_operational_assessments_audited(integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_my_operational_assessments_audited(integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_my_operational_assessments_audited(integer) TO service_role;
