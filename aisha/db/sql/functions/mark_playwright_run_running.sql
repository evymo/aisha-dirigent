-- mark_playwright_run_running
-- Service-role only: runner container marks the row running once Chromium starts.

CREATE OR REPLACE FUNCTION public.mark_playwright_run_running(p_run_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path TO 'public'
AS $$
DECLARE
  v_is_service boolean;
BEGIN
  v_is_service := public.is_service_role();
  IF NOT v_is_service THEN
    RAISE EXCEPTION 'Unauthorized: service_role required';
  END IF;

  UPDATE public.playwright_runs
  SET status = 'running',
      started_at = now()
  WHERE id = p_run_id AND status = 'queued';

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Run not in queued state: %', p_run_id;
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.mark_playwright_run_running(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.mark_playwright_run_running(uuid) TO service_role;
