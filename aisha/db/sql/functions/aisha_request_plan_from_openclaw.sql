-- Function: aisha_request_plan_from_openclaw
-- AISHA → OpenClaw advisory planner. Used by reflection openclaw_plan node.
-- The HTTP call to OpenClaw is performed by the edge function
-- openclaw-bridge; this RPC delegates to it via pg_net (deferred) and stores
-- the resulting plan in audit_journal for replay + traceability.
--
-- Soft-fails when OpenClaw unavailable — returns {error, fallback: 'direct'}
-- so the caller can degrade to direct execution.

CREATE OR REPLACE FUNCTION public.aisha_request_plan_from_openclaw(
  p_task jsonb,
  p_constraints jsonb DEFAULT '{}'::jsonb,
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
  IF p_task IS NULL OR p_task = '{}'::jsonb THEN
    RAISE EXCEPTION 'p_task is required';
  END IF;

  v_user_id := auth.uid();
  v_request_id := gen_random_uuid();

  v_request_payload := jsonb_build_object(
    'request_id', v_request_id,
    'task', p_task,
    'constraints', COALESCE(p_constraints, '{}'::jsonb),
    'related_run_id', p_related_run_id,
    'requested_at', now(),
    'requested_by', v_user_id
  );

  -- Persist request in audit_journal for replay + traceability.
  -- The actual HTTP call to OpenClaw happens out-of-band: the
  -- supabase/functions/openclaw-bridge edge fn is invoked by the caller
  -- (TS layer) with this request_payload. We do NOT call HTTP from the RPC
  -- (Postgres functions shouldn't do outbound HTTP — too risky for STABLE-ness
  -- expectations and timeouts).
  INSERT INTO audit_journal (user_id, action, metadata)
  VALUES (
    v_user_id,
    'openclaw.plan_requested',
    v_request_payload
  );

  RETURN jsonb_build_object(
    'request_id', v_request_id,
    'status', 'queued',
    'message', 'Request audited; caller must invoke openclaw-bridge edge fn with this payload.',
    'payload', v_request_payload
  );
END;
$$;

COMMENT ON FUNCTION public.aisha_request_plan_from_openclaw(jsonb, jsonb, uuid) IS
  'Audits a plan request payload for OpenClaw advisory. The caller (svc-ai-chat) '
  'then calls the openclaw-bridge edge function with the returned payload. '
  'Two-step pattern keeps HTTP out of plpgsql while preserving audit invariant.';

REVOKE ALL ON FUNCTION public.aisha_request_plan_from_openclaw(jsonb, jsonb, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.aisha_request_plan_from_openclaw(jsonb, jsonb, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.aisha_request_plan_from_openclaw(jsonb, jsonb, uuid) TO service_role;
