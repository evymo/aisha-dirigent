-- Function: aisha_record_mcp_test_result
-- Records the outcome of an MCP probe performed by the TS layer.
-- Updates status: tested_ok | tested_failed. After 3 consecutive failures,
-- promotes to 'rejected' so AISHA stops retrying.

CREATE OR REPLACE FUNCTION public.aisha_record_mcp_test_result(
  p_slug text,
  p_ok boolean,
  p_latency_ms int DEFAULT NULL,
  p_supported_methods text[] DEFAULT NULL,
  p_sample_response_excerpt text DEFAULT NULL,
  p_error text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_server   RECORD;
  v_new_status text;
  v_new_failures int;
  v_user_id  uuid;
BEGIN
  IF auth.uid() IS NULL AND current_setting('role', true) != 'service_role' THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  SELECT * INTO v_server FROM mcp_server_registry WHERE slug = p_slug FOR UPDATE;
  IF v_server IS NULL THEN
    RAISE EXCEPTION 'MCP server % not found', p_slug;
  END IF;

  v_user_id := auth.uid();

  IF p_ok THEN
    v_new_status := 'tested_ok';
    v_new_failures := 0;
  ELSE
    v_new_failures := v_server.test_failure_count + 1;
    v_new_status := CASE
      WHEN v_new_failures >= 3 THEN 'rejected'
      ELSE 'tested_failed'
    END;
  END IF;

  UPDATE mcp_server_registry
  SET status = v_new_status,
      last_tested_at = now(),
      last_test_result = jsonb_build_object(
        'ok', p_ok,
        'latency_ms', p_latency_ms,
        'supported_methods', to_jsonb(COALESCE(p_supported_methods, ARRAY[]::text[])),
        'sample_response_excerpt', p_sample_response_excerpt,
        'error', p_error
      ),
      test_failure_count = v_new_failures,
      updated_at = now()
  WHERE id = v_server.id;

  INSERT INTO audit_journal (user_id, action, metadata)
  VALUES (
    v_user_id,
    CASE WHEN p_ok THEN 'mcp.test_succeeded' ELSE 'mcp.test_failed' END,
    jsonb_build_object(
      'mcp_server_id', v_server.id, 'slug', p_slug,
      'new_status', v_new_status, 'failure_count', v_new_failures,
      'latency_ms', p_latency_ms, 'error', p_error
    )
  );

  RETURN jsonb_build_object(
    'slug', p_slug,
    'new_status', v_new_status,
    'failure_count', v_new_failures
  );
END;
$$;

COMMENT ON FUNCTION public.aisha_record_mcp_test_result(text, boolean, int, text[], text, text) IS
  'Records MCP test outcome. Transitions status; after 3 failures auto-rejects.';

REVOKE ALL ON FUNCTION public.aisha_record_mcp_test_result(text, boolean, int, text[], text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.aisha_record_mcp_test_result(text, boolean, int, text[], text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.aisha_record_mcp_test_result(text, boolean, int, text[], text, text) TO service_role;
