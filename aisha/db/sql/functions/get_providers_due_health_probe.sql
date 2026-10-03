-- Function: get_providers_due_health_probe
-- Returns ai_provider_registry rows that the WF_PROVIDER_HEALTH_PROBE n8n
-- workflow should probe next. Rate-limited per provider via
-- last_health_checked_at + EXPONENTIAL BACKOFF on consecutive_failure_count.
--
-- Exponential backoff schedule (instead of flat p_min_interval_seconds):
--   0-2 consecutive failures: probe every p_min_interval_seconds (5min default)
--   3-4 failures:              probe every 1h
--   5-7 failures:              probe every 6h
--   8+ failures:               probe every 24h (max — operator should investigate)
--
-- Rationale: failing providers spam audit_journal with the same 'down' status
-- every 5min and waste probe cycles. Backoff lets the probe system focus on
-- providers that might recover quickly (recent failures) while quieting
-- chronic outages. Counter resets to 0 on first 'healthy' probe.
--
-- Excludes:
--   * is_enabled=false   — operator has explicitly disabled the provider
--   * backend_kind='mcp_server' — those use aisha_test_mcp_server probe path
--     (different protocol — JSON-RPC tools/list vs HTTP /v1/models)
--   * NULL endpoint_url  — can't probe a provider with no endpoint
--
-- Sorts NULL last_health_checked_at first (never probed → highest priority),
-- then by oldest probe timestamp. This way newly-added providers get probed
-- on the very next workflow tick.

CREATE OR REPLACE FUNCTION public.get_providers_due_health_probe(
  p_min_interval_seconds int DEFAULT 300,
  p_limit                int DEFAULT 50
)
RETURNS TABLE (
  slug text,
  backend_kind text,
  endpoint_url text,
  health_url text,
  auth_env_var text,
  last_health_status text,
  last_health_checked_at timestamptz,
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
  SELECT p.slug,
         p.backend_kind,
         p.endpoint_url,
         p.health_url,
         p.auth_env_var,
         p.last_health_status,
         p.last_health_checked_at,
         p.consecutive_failure_count
  FROM   ai_provider_registry p
  WHERE  p.is_enabled = true
    AND  p.backend_kind != 'mcp_server'
    AND  p.endpoint_url IS NOT NULL
    AND  (
           p.last_health_checked_at IS NULL
        OR p.last_health_checked_at < now() - make_interval(secs =>
             CASE
               WHEN p.consecutive_failure_count <= 2 THEN p_min_interval_seconds
               WHEN p.consecutive_failure_count <= 4 THEN 3600     -- 1h
               WHEN p.consecutive_failure_count <= 7 THEN 21600    -- 6h
               ELSE                                        86400   -- 24h
             END
           )
         )
  ORDER  BY p.last_health_checked_at ASC NULLS FIRST
  LIMIT  p_limit;
END;
$$;

REVOKE ALL ON FUNCTION public.get_providers_due_health_probe(int, int) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_providers_due_health_probe(int, int) TO service_role;

COMMENT ON FUNCTION public.get_providers_due_health_probe(int, int) IS
  'WF_PROVIDER_HEALTH_PROBE discovery RPC — returns enabled providers (excl. mcp_server) due for HTTP probe. NULL-first ordering surfaces never-probed providers first. Service-role only.';
