-- Function: get_mcp_registry_admin
-- Returns mcp_server_registry rows for AdminMcpServerRegistry UI. Parallel
-- to get_provider_registry_admin but for the MCP catalog (aisha-knowledge,
-- huggingface-inference, github-mcp, etc.).
--
-- After PR #81 (WF_MCP_PROBE), last_tested_at + last_test_result are
-- updated every 5 min — this RPC surfaces that data to the admin UI.
--
-- Lifecycle awareness: status field has 7 values (discovered → tested_ok
-- → enabled → in_use → tested_failed → deprecated/rejected). Sort order
-- prioritizes operational ones (in_use, enabled) at top.
--
-- Admin-or-staff gate via is_admin_or_staff(). Service role bypasses.

CREATE OR REPLACE FUNCTION public.get_mcp_registry_admin(
  p_transport text    DEFAULT NULL,
  p_status    text    DEFAULT NULL,
  p_active_only boolean DEFAULT false
)
RETURNS TABLE (
  id uuid,
  slug text,
  display_name text,
  description text,
  transport text,
  endpoint_url text,
  stdio_command text[],
  auth_kind text,
  auth_env_var text,
  capability_tags text[],
  exposes_llm boolean,
  status text,
  last_tested_at timestamptz,
  last_test_result jsonb,
  test_failure_count int,
  source text,
  registered_by uuid,
  metadata jsonb,
  created_at timestamptz,
  updated_at timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
STABLE
AS $$
BEGIN
  IF NOT is_admin_or_staff() AND current_setting('role', true) != 'service_role' THEN
    RAISE EXCEPTION 'Admin or staff role required' USING ERRCODE = '22023';
  END IF;

  RETURN QUERY
  SELECT
    m.id,
    m.slug,
    m.display_name,
    m.description,
    m.transport,
    m.endpoint_url,
    m.stdio_command,
    m.auth_kind,
    m.auth_env_var,
    m.capability_tags,
    m.exposes_llm,
    m.status,
    m.last_tested_at,
    m.last_test_result,
    m.test_failure_count,
    m.source,
    m.registered_by,
    m.metadata,
    m.created_at,
    m.updated_at
  FROM mcp_server_registry m
  WHERE (p_transport IS NULL OR m.transport = p_transport)
    AND (p_status IS NULL OR m.status = p_status)
    AND (NOT p_active_only OR m.status IN ('enabled', 'in_use'))
  ORDER BY
    -- Operational lifecycle priority: in_use > enabled > tested_ok > discovered > tested_failed > deprecated > rejected
    CASE m.status
      WHEN 'in_use'         THEN 1
      WHEN 'enabled'        THEN 2
      WHEN 'tested_ok'      THEN 3
      WHEN 'discovered'     THEN 4
      WHEN 'tested_failed'  THEN 5
      WHEN 'deprecated'     THEN 6
      WHEN 'rejected'       THEN 7
      ELSE                       8
    END,
    m.test_failure_count ASC,  -- fewer failures = healthier among same status
    m.slug;
END;
$$;

REVOKE ALL ON FUNCTION public.get_mcp_registry_admin(text, text, boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_mcp_registry_admin(text, text, boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_mcp_registry_admin(text, text, boolean) TO service_role;

COMMENT ON FUNCTION public.get_mcp_registry_admin(text, text, boolean) IS
  'AdminMcpServerRegistry UI read RPC — full mcp_server_registry rows + test history. Admin/staff gate. Sorted by operational lifecycle priority (in_use → rejected) then failure_count then slug.';
