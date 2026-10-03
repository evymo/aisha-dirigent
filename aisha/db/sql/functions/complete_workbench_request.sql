-- Function: complete_workbench_request
-- The aisha-dirigent extension posts a request's result here after running it locally.
-- Idempotent: the status guard (only pending/claimed) makes a retried POST a no-op once the
-- request is already completed/failed. Authenticated (dev = admin/staff) or service_role.
-- Params alphabetical (rpc-params gate).

CREATE OR REPLACE FUNCTION public.complete_workbench_request(
  p_error      text    DEFAULT NULL,
  p_latency_ms integer DEFAULT NULL,
  p_ok         boolean DEFAULT false,
  p_output     text    DEFAULT NULL,
  p_request_id uuid    DEFAULT NULL,
  p_tokens_in  integer DEFAULT NULL,
  p_tokens_out integer DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_row workbench_execution_requests;
BEGIN
  IF auth.uid() IS NULL
     AND (current_setting('request.jwt.claims', true)::jsonb ->> 'role') <> 'service_role' THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '42501';
  END IF;
  IF p_request_id IS NULL THEN
    RAISE EXCEPTION 'p_request_id required' USING ERRCODE = '22023';
  END IF;

  UPDATE workbench_execution_requests
  SET status       = CASE WHEN p_ok THEN 'completed' ELSE 'failed' END,
      response     = p_output,
      error_detail = CASE WHEN p_ok THEN NULL
                          ELSE jsonb_build_object('message', COALESCE(p_error, 'workbench_error')) END,
      tokens_in    = p_tokens_in,
      tokens_out   = p_tokens_out,
      latency_ms   = p_latency_ms,
      completed_at = now()
  WHERE id = p_request_id
    AND status IN ('pending', 'claimed')   -- idempotent: a second POST after completion is a no-op
  RETURNING * INTO v_row;

  IF v_row.id IS NULL THEN
    RETURN jsonb_build_object('request_id', p_request_id, 'updated', false);
  END IF;
  RETURN jsonb_build_object('request_id', v_row.id, 'status', v_row.status, 'updated', true);
END;
$$;

REVOKE ALL ON FUNCTION public.complete_workbench_request(text, integer, boolean, text, uuid, integer, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.complete_workbench_request(text, integer, boolean, text, uuid, integer, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.complete_workbench_request(text, integer, boolean, text, uuid, integer, integer) TO service_role;

COMMENT ON FUNCTION public.complete_workbench_request(text, integer, boolean, text, uuid, integer, integer) IS
  'PR-J: the extension posts a workbench request result (completed/failed); idempotent via the status guard. authenticated/service_role.';
