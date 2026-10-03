-- Function: get_runtimes_due_health_probe
-- Returns ai_runtime_registry rows that WF_RUNTIME_HEALTH_PROBE should probe next.
-- Rate-limited per runtime via adapter_health_checked_at + EXPONENTIAL BACKOFF on
-- consecutive_failure_count (mirrors get_providers_due_health_probe):
--   0-2 failures: every p_min_interval_seconds (5min default)
--   3-4:          every 1h
--   5-7:          every 6h
--   8+:           every 24h (max — operator should investigate)
--
-- The probe TARGET is NOT stored on the row (a runtime's reachability endpoint —
-- e.g. OPENCLAW_URL — is env/config, not a static seed value); the WF's code node
-- resolves it per runtime_kind. This RPC only schedules WHICH runtimes are due.
--
-- Excludes:
--   * is_enabled=false   — operator explicitly disabled the runtime
--   * runtime_kind='human' — a human executor has no probeable service
--
-- NULL adapter_health_checked_at sorts first (never probed → highest priority), so
-- a newly-registered runtime gets probed on the very next workflow tick.

CREATE OR REPLACE FUNCTION public.get_runtimes_due_health_probe(
  p_min_interval_seconds int DEFAULT 300,
  p_limit                int DEFAULT 50
)
RETURNS TABLE (
  runtime_kind text,
  slug text,
  adapter_health text,
  adapter_health_checked_at timestamptz,
  consecutive_failure_count int
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
STABLE
AS $$
BEGIN
  IF auth.uid() IS NULL AND current_setting('role', true) != 'service_role' THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '22023';
  END IF;

  RETURN QUERY
  SELECT r.runtime_kind,
         r.slug,
         r.adapter_health,
         r.adapter_health_checked_at,
         r.consecutive_failure_count
  FROM   ai_runtime_registry r
  WHERE  r.is_enabled = true
    AND  r.runtime_kind <> 'human'
    AND  (
           r.adapter_health_checked_at IS NULL
        OR r.adapter_health_checked_at < now() - make_interval(secs =>
             CASE
               WHEN r.consecutive_failure_count <= 2 THEN p_min_interval_seconds
               WHEN r.consecutive_failure_count <= 4 THEN 3600     -- 1h
               WHEN r.consecutive_failure_count <= 7 THEN 21600    -- 6h
               ELSE                                        86400   -- 24h
             END
           )
         )
  ORDER  BY r.adapter_health_checked_at ASC NULLS FIRST
  LIMIT  p_limit;
END;
$$;

REVOKE ALL ON FUNCTION public.get_runtimes_due_health_probe(int, int) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_runtimes_due_health_probe(int, int) TO service_role;

COMMENT ON FUNCTION public.get_runtimes_due_health_probe(int, int) IS
  'WF_RUNTIME_HEALTH_PROBE discovery RPC — enabled runtimes (excl. human) due for a reachability probe, exponential backoff, NULL-first. Service-role only.';
