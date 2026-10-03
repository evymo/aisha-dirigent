-- Function: fetch_workbench_result
-- The central adapter block-polls this for a request's status/result after enqueue.
-- service_role only. STABLE (read-only).

CREATE OR REPLACE FUNCTION public.fetch_workbench_result(p_request_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
STABLE
AS $$
DECLARE
  v_row workbench_execution_requests;
BEGIN
  IF (current_setting('request.jwt.claims', true)::jsonb ->> 'role') <> 'service_role' THEN
    RAISE EXCEPTION 'Service role required' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_row FROM workbench_execution_requests WHERE id = p_request_id;
  IF v_row.id IS NULL THEN
    RAISE EXCEPTION 'Request % not found', p_request_id USING ERRCODE = '22023';
  END IF;

  RETURN jsonb_build_object(
    'request_id', v_row.id,
    'status', v_row.status,
    'output', v_row.response,
    'tokens_in', v_row.tokens_in,
    'tokens_out', v_row.tokens_out,
    'latency_ms', v_row.latency_ms,
    'error_detail', v_row.error_detail
  );
END;
$$;

REVOKE ALL ON FUNCTION public.fetch_workbench_result(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.fetch_workbench_result(uuid) TO service_role;

COMMENT ON FUNCTION public.fetch_workbench_result(uuid) IS
  'PR-J: poll a workbench request status/result (the central adapter blocks on this). service_role only.';
