-- ============================================================================
-- Function: aitg_get_trust_score_audited
-- Purpose: Single-number self-assessment for Aisha. Severity-weighted pass-rate
--          across all enabled tests over a sliding window. Returns 0..100
--          where 100 = every test passed every run, 0 = every test failed
--          every run.
-- AuthZ: admin/staff/service_role.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.aitg_get_trust_score_audited(p_window_days int DEFAULT 30)
RETURNS TABLE (
  trust_score      numeric,
  weighted_total   numeric,
  weighted_passed  numeric,
  measured_tests   int,
  failing_tests    int,
  window_days      int
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
  VALUES (auth.uid(), 'aitg.trust_score_read', 'aitg.trust_score_read', 'security', 'info',
          ARRAY['aitg', 'trust'], jsonb_build_object('window_days', p_window_days));

  RETURN QUERY
  WITH coverage AS (
    SELECT c.test_id,
           c.severity_weight AS w,
           COUNT(r.run_id) FILTER (WHERE r.status IN ('passed', 'failed'))::numeric AS total,
           COUNT(r.run_id) FILTER (WHERE r.status = 'passed')::numeric AS passed,
           COUNT(r.run_id) FILTER (WHERE r.status = 'failed')::int AS failed
    FROM public.aitg_test_catalog c
    LEFT JOIN public.aitg_runs r
      ON r.test_id = c.test_id
     AND r.finished_at >= now() - (p_window_days || ' days')::interval
    WHERE c.enabled
    GROUP BY c.test_id, c.severity_weight
  )
  SELECT
    ROUND(
      COALESCE(SUM(passed * w) / NULLIF(SUM(total * w), 0), 0) * 100, 2
    ) AS trust_score,
    SUM(total * w) AS weighted_total,
    SUM(passed * w) AS weighted_passed,
    COUNT(*) FILTER (WHERE total > 0)::int AS measured_tests,
    COUNT(*) FILTER (WHERE failed > 0)::int AS failing_tests,
    p_window_days AS window_days
  FROM coverage;
END;
$$;

REVOKE ALL ON FUNCTION public.aitg_get_trust_score_audited(int) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.aitg_get_trust_score_audited(int) TO authenticated;
GRANT EXECUTE ON FUNCTION public.aitg_get_trust_score_audited(int) TO service_role;
