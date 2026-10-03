-- Function: public.get_my_latest_operational_assessment_audited
-- Arguments: none
-- Security: SECURITY DEFINER
-- Source: Extracted from local DB (source-of-truth sync)

CREATE OR REPLACE FUNCTION public.get_my_latest_operational_assessment_audited()
 RETURNS TABLE(id uuid, assessment_type text, status text, overall_score numeric, interpretation text, trend_vs_baseline numeric, alert_flags text[], has_critical_flags boolean, completed_at timestamptz, dimensions jsonb)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  -- Audit log using write_audit_journal
  PERFORM public.write_audit_journal(
      p_action_type := 'view'::journal_action_type,
      p_area := 'operational_data'::journal_area,
      p_details := jsonb_build_object('type', 'latest'),
      p_entity_id := NULL,
      p_entity_type := 'operational_assessment',
      p_severity := 'info'::journal_severity,
      p_summary := 'User viewed latest operational assessment',
    p_user_id := auth.uid()
  );

  RETURN QUERY
  SELECT
    ca.id,
    ca.assessment_type,
    ca.status::TEXT,
    ca.overall_score,
    ca.interpretation,
    ca.trend_vs_baseline,
    ca.alert_flags,
    ca.has_critical_flags,
    ca.completed_at,
    -- Per-dimension data: prefer the normalized operational_assessment_dimensions
    -- rows (now populated by save_operational_assessment_dimension as the output
    -- of the scoring logic — the queryable source of truth). Fall back to the
    -- operational_assessments.dimensions JSONB cache for assessments completed
    -- before the normalized writer existed, then to an empty array.
    COALESCE(
      (
        SELECT jsonb_agg(
                 jsonb_build_object(
                   'dimension', d.dimension,
                   'rawScore', d.raw_score,
                   'normalizedScore', d.normalized_score,
                   'tagCount', d.tag_count,
                   'hasNegativeIndicators', d.has_negative_indicators,
                   'operationalFlags', d.operational_flags
                 )
                 ORDER BY d.dimension
               )
        FROM operational_assessment_dimensions d
        WHERE d.assessment_id = ca.id
      ),
      NULLIF(ca.dimensions, '[]'::jsonb),
      '[]'::jsonb
    ) AS dimensions
  FROM operational_assessments ca
  WHERE ca.user_id = auth.uid()
    AND ca.status = 'completed'
  ORDER BY ca.completed_at DESC
  LIMIT 1;
END;
$function$;

REVOKE ALL ON FUNCTION public.get_my_latest_operational_assessment_audited() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_my_latest_operational_assessment_audited() TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_my_latest_operational_assessment_audited() TO service_role;
