-- list_playwright_runs
-- Admin/staff facing audited READ used by the Appsmith Playwright QA page.
-- Returns the latest N runs (newest first) with the columns the dashboard
-- table renders, optionally filtered by status set + time window.
--
-- Does NOT leak service-role concerns (no internal runner tokens, no raw
-- runner stdout) — those live in the report bucket which Appsmith renders
-- through a signed URL when the operator clicks "View Report".

CREATE OR REPLACE FUNCTION public.list_playwright_runs(
  p_limit integer DEFAULT 50,
  p_status_filter text[] DEFAULT NULL,
  p_window_hours integer DEFAULT 168
)
RETURNS TABLE (
  id uuid,
  trigger_kind public.playwright_run_trigger,
  target_env text,
  target_base_url text,
  suite text,
  deploy_ref text,
  status public.playwright_run_status,
  total integer,
  passed integer,
  failed integer,
  skipped integer,
  duration_ms integer,
  report_storage_path text,
  error_message text,
  requested_by uuid,
  approval_required boolean,
  approved_by uuid,
  approved_at timestamptz,
  created_at timestamptz,
  started_at timestamptz,
  finished_at timestamptz,
  app_name text,
  active_slot text,
  story_id uuid,
  triggered_rollback_id uuid,
  metadata jsonb
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_limit integer := LEAST(GREATEST(COALESCE(p_limit, 50), 1), 500);
  v_window integer := LEAST(GREATEST(COALESCE(p_window_hours, 168), 1), 24 * 30);
BEGIN
  IF NOT public.is_admin_or_staff() THEN
    RAISE EXCEPTION 'Unauthorized: admin/staff required';
  END IF;

  RETURN QUERY
  SELECT
    r.id, r.trigger_kind, r.target_env, r.target_base_url, r.suite, r.deploy_ref,
    r.status, r.total, r.passed, r.failed, r.skipped, r.duration_ms,
    r.report_storage_path, r.error_message,
    r.requested_by, r.approval_required, r.approved_by, r.approved_at,
    r.created_at, r.started_at, r.finished_at,
    r.app_name, r.active_slot, r.story_id, r.triggered_rollback_id,
    r.metadata
  FROM public.playwright_runs r
  WHERE r.created_at >= now() - make_interval(hours => v_window)
    AND (p_status_filter IS NULL OR r.status::text = ANY(p_status_filter))
  ORDER BY r.created_at DESC
  LIMIT v_limit;
END;
$$;

REVOKE ALL ON FUNCTION public.list_playwright_runs(integer, text[], integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.list_playwright_runs(integer, text[], integer) TO authenticated;
