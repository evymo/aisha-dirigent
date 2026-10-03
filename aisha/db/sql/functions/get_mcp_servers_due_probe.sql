-- Function: get_mcp_servers_due_probe
-- Returns mcp_server_registry rows that the WF_MCP_PROBE n8n workflow should
-- test next. Rate-limited per server via last_tested_at + EXPONENTIAL
-- BACKOFF on test_failure_count.
--
-- Exponential backoff schedule (mirrors get_providers_due_health_probe):
--   0-2 failures: probe every p_min_interval_seconds (5min default)
--   3-4 failures: probe every 1h
--   5-7 failures: probe every 6h
--   8+ failures:  probe every 24h (max — operator should investigate)
--
-- Counter is in test_failure_count column (managed by aisha_record_mcp_test_result).
-- Reset to 0 on first successful probe via that same RPC.
--
-- Excludes:
--   * status='rejected' OR 'deprecated' — operator has explicitly retired
--   * transport='stdio' — n8n can't execute stdio probes reliably; those
--     belong to the svc-ai-chat in-process reflection runner where the
--     mcp_test node has proper subprocess management.
--   * NULL endpoint_url for non-stdio transports — can't probe
--
-- Sorts NULL last_tested_at first (never probed → highest priority).

CREATE OR REPLACE FUNCTION public.get_mcp_servers_due_probe(
  p_min_interval_seconds int DEFAULT 300,
  p_limit                int DEFAULT 20
)
RETURNS TABLE (
  slug text,
  transport text,
  endpoint_url text,
  auth_env_var text,
  status text,
  last_tested_at timestamptz,
  test_failure_count int
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
  SELECT m.slug,
         m.transport,
         m.endpoint_url,
         m.auth_env_var,
         m.status,
         m.last_tested_at,
         m.test_failure_count
  FROM   mcp_server_registry m
  WHERE  m.status NOT IN ('rejected', 'deprecated')
    AND  m.transport != 'stdio'
    AND  m.endpoint_url IS NOT NULL
    AND  (
           m.last_tested_at IS NULL
        OR m.last_tested_at < now() - make_interval(secs =>
             CASE
               WHEN m.test_failure_count <= 2 THEN p_min_interval_seconds
               WHEN m.test_failure_count <= 4 THEN 3600     -- 1h
               WHEN m.test_failure_count <= 7 THEN 21600    -- 6h
               ELSE                                86400    -- 24h
             END
           )
         )
  ORDER  BY m.last_tested_at ASC NULLS FIRST
  LIMIT  p_limit;
END;
$$;

REVOKE ALL ON FUNCTION public.get_mcp_servers_due_probe(int, int) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_mcp_servers_due_probe(int, int) TO service_role;

COMMENT ON FUNCTION public.get_mcp_servers_due_probe(int, int) IS
  'WF_MCP_PROBE discovery RPC — returns active MCP servers (excl. stdio transport + rejected/deprecated) due for HTTP/SSE probe. NULL-first ordering surfaces never-probed servers first. Service-role only.';
