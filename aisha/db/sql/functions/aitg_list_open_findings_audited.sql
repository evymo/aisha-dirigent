-- ============================================================================
-- Function: aitg_list_open_findings_audited
-- Purpose: Findings without fixed_at, ordered by severity. Aisha uses this to
--          discover what she should remediate next.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.aitg_list_open_findings_audited(
  p_min_severity aitg_severity DEFAULT 'medium',
  p_limit        int           DEFAULT 100
) RETURNS TABLE (
  finding_id        uuid,
  run_id            uuid,
  test_id           text,
  finding_severity  aitg_severity,
  observed          jsonb,
  classifier_score  numeric,
  remediation       text,
  observed_at       timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_is_service_role boolean;
  v_min_rank        int;
BEGIN
  v_is_service_role := public.is_service_role();
  IF NOT v_is_service_role AND NOT public.is_admin_or_staff() THEN
    RAISE EXCEPTION 'AITG_INSUFFICIENT_PRIVILEGE' USING ERRCODE = '42501';
  END IF;

  v_min_rank := CASE p_min_severity
    WHEN 'info' THEN 0 WHEN 'low' THEN 1 WHEN 'medium' THEN 2
    WHEN 'high' THEN 3 WHEN 'critical' THEN 4 END;

  INSERT INTO public.audit_journal (user_id, action, action_type, area, severity, tags, details)
  VALUES (auth.uid(), 'aitg.findings_listed', 'aitg.findings_listed', 'security', 'info',
          ARRAY['aitg', 'findings'], jsonb_build_object('min_severity', p_min_severity, 'limit', p_limit));

  RETURN QUERY
  SELECT f.finding_id, f.run_id, r.test_id, f.severity, f.observed,
         f.classifier_score, f.remediation, r.finished_at
  FROM public.aitg_findings f
  JOIN public.aitg_runs r ON r.run_id = f.run_id
  WHERE f.fixed_at IS NULL
    AND (CASE f.severity
           WHEN 'info' THEN 0 WHEN 'low' THEN 1 WHEN 'medium' THEN 2
           WHEN 'high' THEN 3 WHEN 'critical' THEN 4 END) >= v_min_rank
  ORDER BY
    (CASE f.severity
       WHEN 'critical' THEN 4 WHEN 'high' THEN 3 WHEN 'medium' THEN 2
       WHEN 'low' THEN 1 ELSE 0 END) DESC,
    r.finished_at DESC
  LIMIT GREATEST(p_limit, 1);
END;
$$;

REVOKE ALL ON FUNCTION public.aitg_list_open_findings_audited(aitg_severity, int) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.aitg_list_open_findings_audited(aitg_severity, int) TO authenticated;
GRANT EXECUTE ON FUNCTION public.aitg_list_open_findings_audited(aitg_severity, int) TO service_role;
