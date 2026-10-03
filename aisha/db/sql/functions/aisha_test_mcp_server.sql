-- Function: aisha_test_mcp_server
-- Two-step pattern: records a test-attempt audit + returns a probe payload.
-- The TS layer (svc-ai-chat /mcp/test route) actually performs the HTTP/stdio
-- probe and then calls aisha_record_mcp_test_result with the outcome.
--
-- Why two-step: same reason as aisha_request_plan_from_openclaw — keep HTTP
-- out of plpgsql to preserve STABLE semantics and avoid pool exhaustion.

CREATE OR REPLACE FUNCTION public.aisha_test_mcp_server(
  p_slug text,
  p_probe_method text DEFAULT 'tools/list'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_server  RECORD;
  v_user_id uuid;
  v_test_id uuid;
  v_payload jsonb;
BEGIN
  IF auth.uid() IS NULL AND current_setting('role', true) != 'service_role' THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  SELECT * INTO v_server
  FROM mcp_server_registry
  WHERE slug = p_slug;

  IF v_server IS NULL THEN
    RAISE EXCEPTION 'MCP server % not found in registry', p_slug;
  END IF;

  v_user_id := auth.uid();
  v_test_id := gen_random_uuid();

  v_payload := jsonb_build_object(
    'test_id', v_test_id,
    'mcp_server_id', v_server.id,
    'slug', v_server.slug,
    'transport', v_server.transport,
    'endpoint_url', v_server.endpoint_url,
    'stdio_command', to_jsonb(v_server.stdio_command),
    'auth_kind', v_server.auth_kind,
    'auth_env_var', v_server.auth_env_var,
    'probe_method', p_probe_method,
    'requested_at', now()
  );

  INSERT INTO audit_journal (user_id, action, metadata)
  VALUES (v_user_id, 'mcp.test_requested', v_payload);

  RETURN jsonb_build_object(
    'test_id', v_test_id,
    'slug', p_slug,
    'status', 'queued',
    'payload', v_payload,
    'message', 'Test request audited; caller invokes /mcp/test on svc-ai-chat with this payload.'
  );
END;
$$;

COMMENT ON FUNCTION public.aisha_test_mcp_server(text, text) IS
  'Audits an MCP server test request. Caller (svc-ai-chat) performs the probe and writes result via aisha_record_mcp_test_result.';

REVOKE ALL ON FUNCTION public.aisha_test_mcp_server(text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.aisha_test_mcp_server(text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.aisha_test_mcp_server(text, text) TO service_role;
