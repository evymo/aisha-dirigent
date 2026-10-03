-- Function: get_pending_batch_jobs
-- Returns batch jobs that WF_BATCH_POLLER should poll next. Rate-limited per
-- job via last_polled_at (don't poll the same job more than once per 5min).

CREATE OR REPLACE FUNCTION public.get_pending_batch_jobs(
  p_limit int DEFAULT 50,
  p_min_poll_interval_seconds int DEFAULT 300
)
RETURNS TABLE (
  id uuid,
  provider text,
  external_batch_id text,
  status text,
  submitted_at timestamptz,
  last_polled_at timestamptz,
  request_count int,
  related_run_id uuid,
  agent_slug text,
  metadata jsonb
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
STABLE
AS $$
BEGIN
  IF auth.uid() IS NULL AND current_setting('role', true) != 'service_role' THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  RETURN QUERY
  SELECT j.id, j.provider, j.external_batch_id, j.status,
         j.submitted_at, j.last_polled_at, j.request_count,
         j.related_run_id, j.agent_slug, j.metadata
  FROM ai_batch_jobs j
  WHERE j.status IN ('submitted', 'in_progress')
    AND (
      j.last_polled_at IS NULL
      OR j.last_polled_at < now() - make_interval(secs => p_min_poll_interval_seconds)
    )
  ORDER BY j.last_polled_at NULLS FIRST, j.submitted_at
  LIMIT GREATEST(1, p_limit);
END;
$$;

COMMENT ON FUNCTION public.get_pending_batch_jobs(int, int) IS
  'Lists batch jobs eligible for polling (status in submitted/in_progress, '
  'not polled within p_min_poll_interval_seconds).';

REVOKE ALL ON FUNCTION public.get_pending_batch_jobs(int, int) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_pending_batch_jobs(int, int) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_pending_batch_jobs(int, int) TO service_role;
