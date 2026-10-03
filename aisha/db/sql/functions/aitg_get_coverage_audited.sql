-- ============================================================================
-- Function: aitg_get_coverage_audited
-- Purpose: Per-test pass-rate over a sliding window. Single source of truth
--          for Appsmith dashboard "AITG Trust Score" panel + Aisha's
--          self-assessment MCP tool.
-- AuthZ: admin, staff (read access to security posture); service_role for
--        Aisha's autonomous self-checks.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.aitg_get_coverage_audited(p_window_days int DEFAULT 30)
RETURNS TABLE (
  layer        aitg_layer,
  test_id      text,
  total_runs   int,
  passed_runs  int,
  failed_runs  int,
  pass_rate    numeric,
  last_run     timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_is_service_role boolean;
BEGIN
  v_is_service_role := public.is_service_role();
  IF NOT v_is_service_role AND NOT public.is_admin_or_staff() THEN
    RAISE EXCEPTION 'AITG_INSUFFICIENT_PRIVILEGE' USING ERRCODE = '42501';
  END IF;

  INSERT INTO public.audit_journal (user_id, action, action_type, area, severity, tags, details)
  VALUES (auth.uid(), 'aitg.coverage_read', 'aitg.coverage_read', 'security', 'info',
          ARRAY['aitg', 'read'], jsonb_build_object('window_days', p_window_days));

  RETURN QUERY
  SELECT c.layer,
         c.test_id,
         COUNT(r.run_id)::int AS total_runs,
         COUNT(*) FILTER (WHERE r.status = 'passed')::int AS passed_runs,
         COUNT(*) FILTER (WHERE r.status = 'failed')::int AS failed_runs,
         ROUND(
           COUNT(*) FILTER (WHERE r.status = 'passed')::numeric
           / NULLIF(COUNT(r.run_id), 0), 4
         ) AS pass_rate,
         MAX(r.finished_at) AS last_run
  FROM public.aitg_test_catalog c
  LEFT JOIN public.aitg_runs r
    ON r.test_id = c.test_id
   AND r.finished_at >= now() - (p_window_days || ' days')::interval
  WHERE c.enabled
  GROUP BY c.layer, c.test_id;
END;
$$;

REVOKE ALL ON FUNCTION public.aitg_get_coverage_audited(int) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.aitg_get_coverage_audited(int) TO authenticated;
GRANT EXECUTE ON FUNCTION public.aitg_get_coverage_audited(int) TO service_role;
