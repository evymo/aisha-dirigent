-- Function: aisha_dryrun_in_openclaw_sandbox
-- AISHA → OpenClaw sandbox dry-run request. Used by reflection openclaw_sandbox
-- node + risky n8n workflow validation.
--
-- Same two-step pattern as aisha_request_plan_from_openclaw: audits the
-- request, returns a request_id; the TS caller then invokes the edge fn
-- openclaw-bridge to perform the actual HTTP roundtrip.

CREATE OR REPLACE FUNCTION public.aisha_dryrun_in_openclaw_sandbox(
  p_workflow_json jsonb,
  p_inputs jsonb DEFAULT '{}'::jsonb,
  p_timeout_s int DEFAULT 120,
  p_related_run_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_request_id      uuid;
  v_user_id         uuid;
  v_request_payload jsonb;
BEGIN
  IF auth.uid() IS NULL AND current_setting('role', true) != 'service_role' THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;
  IF p_workflow_json IS NULL OR p_workflow_json = '{}'::jsonb THEN
    RAISE EXCEPTION 'p_workflow_json is required';
  END IF;
  IF p_timeout_s < 5 OR p_timeout_s > 600 THEN
    RAISE EXCEPTION 'p_timeout_s must be 5..600 seconds';
  END IF;

  v_user_id := auth.uid();
  v_request_id := gen_random_uuid();

  v_request_payload := jsonb_build_object(
    'request_id', v_request_id,
    'workflow_json', p_workflow_json,
    'inputs', COALESCE(p_inputs, '{}'::jsonb),
    'timeout_s', p_timeout_s,
    'related_run_id', p_related_run_id,
    'requested_at', now(),
    'requested_by', v_user_id
  );

  INSERT INTO audit_journal (user_id, action, metadata)
  VALUES (
    v_user_id,
    'openclaw.sandbox_dryrun_requested',
    v_request_payload
  );

  RETURN jsonb_build_object(
    'request_id', v_request_id,
    'status', 'queued',
    'message', 'Sandbox request audited; caller invokes openclaw-bridge.',
    'payload', v_request_payload
  );
END;
$$;

COMMENT ON FUNCTION public.aisha_dryrun_in_openclaw_sandbox(jsonb, jsonb, int, uuid) IS
  'Audits a sandbox dry-run request for OpenClaw advisory. Caller invokes the '
  'openclaw-bridge edge fn to perform the HTTP call.';

REVOKE ALL ON FUNCTION public.aisha_dryrun_in_openclaw_sandbox(jsonb, jsonb, int, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.aisha_dryrun_in_openclaw_sandbox(jsonb, jsonb, int, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.aisha_dryrun_in_openclaw_sandbox(jsonb, jsonb, int, uuid) TO service_role;
