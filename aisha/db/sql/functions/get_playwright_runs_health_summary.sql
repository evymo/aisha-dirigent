-- get_playwright_runs_health_summary
-- Admin/staff facing audited READ used by the Appsmith Playwright QA page
-- stat cards (queued / running / awaiting approval / passed-24h / failed-24h
-- / rollbacks-triggered). Window defaults to 24 h to match the AITG page.

CREATE OR REPLACE FUNCTION public.get_playwright_runs_health_summary(
  p_window_hours integer DEFAULT 24
)
RETURNS TABLE (
  queued integer,
  running integer,
  awaiting_approval integer,
  passed integer,
  failed integer,
  errored integer,
  aborted integer,
  rollbacks_triggered integer,
  window_hours integer
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_window integer := LEAST(GREATEST(COALESCE(p_window_hours, 24), 1), 24 * 30);
BEGIN
  IF NOT public.is_admin_or_staff() THEN
    RAISE EXCEPTION 'Unauthorized: admin/staff required';
  END IF;

  RETURN QUERY
  SELECT
    -- "queued / running / awaiting_approval" are point-in-time gauges; they
    -- include rows that were queued long ago and never picked up (stuck-runner
    -- detection). Operator notices those because the count won't fall.
    COUNT(*) FILTER (WHERE status = 'queued')::integer AS queued,
    COUNT(*) FILTER (WHERE status = 'running')::integer AS running,
    COUNT(*) FILTER (WHERE status = 'queued' AND approval_required AND approved_at IS NULL)::integer AS awaiting_approval,
    -- Terminal counters are windowed (operator wants "did QA hold up in the
    -- last day?", not "lifetime totals").
    COUNT(*) FILTER (WHERE status = 'passed' AND finished_at >= now() - make_interval(hours => v_window))::integer AS passed,
    COUNT(*) FILTER (WHERE status = 'failed' AND finished_at >= now() - make_interval(hours => v_window))::integer AS failed,
    COUNT(*) FILTER (WHERE status = 'errored' AND finished_at >= now() - make_interval(hours => v_window))::integer AS errored,
    COUNT(*) FILTER (WHERE status = 'aborted' AND finished_at >= now() - make_interval(hours => v_window))::integer AS aborted,
    COUNT(*) FILTER (WHERE triggered_rollback_id IS NOT NULL AND finished_at >= now() - make_interval(hours => v_window))::integer AS rollbacks_triggered,
    v_window AS window_hours
  FROM public.playwright_runs;
END;
$$;

REVOKE ALL ON FUNCTION public.get_playwright_runs_health_summary(integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_playwright_runs_health_summary(integer) TO authenticated;
