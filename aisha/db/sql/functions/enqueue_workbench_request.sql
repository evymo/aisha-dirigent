-- Function: enqueue_workbench_request
-- The central adapter (runtime_dispatch → workbenchAdapter.execute) enqueues a unit of
-- work for the aisha-dirigent extension to run on a local model. Returns the request id;
-- the adapter then block-polls fetch_workbench_result. service_role only (the adapter runs
-- as the system). Params alphabetical (rpc-params gate).

CREATE OR REPLACE FUNCTION public.enqueue_workbench_request(
  p_clow          jsonb,
  p_decision_id   uuid    DEFAULT NULL,
  p_input         text    DEFAULT '',
  p_model_id      text    DEFAULT NULL,
  p_provider_slug text    DEFAULT NULL,
  p_run_id        uuid    DEFAULT NULL,
  p_story_id      uuid    DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_id uuid;
BEGIN
  IF (current_setting('request.jwt.claims', true)::jsonb ->> 'role') <> 'service_role' THEN
    RAISE EXCEPTION 'Service role required' USING ERRCODE = '42501';
  END IF;

  INSERT INTO workbench_execution_requests
    (clow, request_input, model_id, provider_slug, run_id, story_id, decision_id, status)
  VALUES (p_clow, p_input, p_model_id, p_provider_slug, p_run_id, p_story_id, p_decision_id, 'pending')
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;

REVOKE ALL ON FUNCTION public.enqueue_workbench_request(jsonb, uuid, text, text, text, uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.enqueue_workbench_request(jsonb, uuid, text, text, text, uuid, uuid) TO service_role;

COMMENT ON FUNCTION public.enqueue_workbench_request(jsonb, uuid, text, text, text, uuid, uuid) IS
  'PR-J: enqueue a workbench execution request (pending) for the extension to claim+run. service_role only.';
