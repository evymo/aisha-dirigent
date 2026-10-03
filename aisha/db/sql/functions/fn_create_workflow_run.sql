-- Function: fn_create_workflow_run
-- AISHA kick-off helper: creates an ai_runs entry bound to a workflow definition.
-- Returns the new run_id which the langgraph runner then orchestrates.
-- The graph itself is loaded by the runner from ai_workflow_definitions.graph.

CREATE OR REPLACE FUNCTION public.fn_create_workflow_run(
  p_workflow_definition_id uuid,
  p_input jsonb DEFAULT '{}'::jsonb,
  p_context jsonb DEFAULT '{}'::jsonb,
  p_story_id uuid DEFAULT NULL,
  p_actor_user_id uuid DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_run_id     uuid;
  v_def        RECORD;
  v_kind       text;
  v_actor      uuid;
  v_run_status text := 'pending';
  v_authz      jsonb;
  v_awaiting   text;
BEGIN
  -- Auth
  IF auth.uid() IS NULL AND current_setting('role', true) != 'service_role' THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  IF p_workflow_definition_id IS NULL THEN
    RAISE EXCEPTION 'p_workflow_definition_id is required';
  END IF;

  -- Load workflow definition + validate active
  SELECT id, name, display_name, context, is_active, version
  INTO v_def
  FROM ai_workflow_definitions
  WHERE id = p_workflow_definition_id;

  IF v_def IS NULL THEN
    RAISE EXCEPTION 'Workflow definition % not found', p_workflow_definition_id;
  END IF;

  IF NOT v_def.is_active THEN
    RAISE EXCEPTION 'Workflow definition % (%) is not active', v_def.name, p_workflow_definition_id;
  END IF;

  -- Derive run kind from workflow context (chat/reflection/deploy/...)
  v_kind := COALESCE(v_def.context, 'reflection');

  -- Resolve actor: explicit param > auth.uid() > NULL (service_role acting autonomously)
  v_actor := COALESCE(p_actor_user_id, auth.uid());

  -- Spend admission gate (pre-flight): estimate × policy × budget via
  -- fn_authorize_task_spend (history→catalog estimate; ai_spend_policies
  -- most-specific-wins with catalog-band defaults; ai_budget remaining
  -- across ALL periods — supersedes the old binary lifetime-only check).
  -- Stack-default exemption lives inside the authorizer.
  --   allow → pending (runner picks up)
  --   ask   → blocked + awaiting='spend_approval' (Mission Control pane)
  --   deny  → blocked + awaiting='spend_denied' (visible, not silently lost)
  v_authz := public.fn_authorize_task_spend(v_kind, p_story_id);
  IF v_authz->>'decision' = 'ask' THEN
    v_run_status := 'blocked';
    v_awaiting   := 'spend_approval';
  ELSIF v_authz->>'decision' = 'deny' THEN
    v_run_status := 'blocked';
    v_awaiting   := 'spend_denied';
  END IF;

  INSERT INTO ai_runs (
    kind,
    story_id,
    actor_user_id,
    status,
    workflow_definition_id,
    metadata,
    cost_total_json
  )
  VALUES (
    v_kind,
    p_story_id,
    v_actor,
    v_run_status,        -- 'pending' (runner picks up) | 'blocked' (spend ask/deny)
    p_workflow_definition_id,
    jsonb_strip_nulls(jsonb_build_object(
      'workflow_name', v_def.name,
      'workflow_version', v_def.version,
      'input', p_input,
      'context', p_context,
      'checkpoint', jsonb_build_object(
        'current_node', NULL,
        'iteration', 0,
        'history', '[]'::jsonb
      ),
      'created_via', 'fn_create_workflow_run',
      'awaiting', v_awaiting,
      'estimated_cost', NULLIF(v_authz->>'estimate_used', ''),
      'spend_authorization', v_authz
    )),
    '{}'::jsonb
  )
  RETURNING id INTO v_run_id;

  -- Trace event
  INSERT INTO ai_trace_events (
    run_id, event_type, operation, status, request_summary, response_summary
  )
  VALUES (
    v_run_id,
    -- 'workflow_start' is the matching ai_event_type member; 'workflow_create'
    -- is not a member, so this INSERT (event_type is ai_event_type NOT NULL)
    -- raised `invalid input value for enum ai_event_type` on every call.
    'workflow_start',
    'fn_create_workflow_run',
    'ok',
    jsonb_build_object(
      'workflow_definition_id', p_workflow_definition_id,
      'workflow_name', v_def.name,
      'story_id', p_story_id
    ),
    jsonb_build_object('run_id', v_run_id, 'kind', v_kind)
  );

  -- Audit
  INSERT INTO audit_journal (user_id, action, metadata)
  VALUES (
    v_actor,
    'workflow.run_created',
    jsonb_build_object(
      'run_id', v_run_id,
      'workflow_definition_id', p_workflow_definition_id,
      'workflow_name', v_def.name,
      'story_id', p_story_id,
      'admission_status', v_run_status
    )
  );

  -- Governance signal: run blocked at admission by an exhausted story budget.
  IF v_run_status = 'blocked' THEN
    INSERT INTO audit_journal (user_id, action, metadata)
    VALUES (
      v_actor,
      'ai.budget.run_blocked',
      jsonb_build_object(
        'run_id', v_run_id,
        'story_id', p_story_id,
        'stage', 'admission'
      )
    );
  END IF;

  RETURN v_run_id;
END;
$$;

COMMENT ON FUNCTION public.fn_create_workflow_run(uuid, jsonb, jsonb, uuid, uuid) IS
  'Creates an ai_runs entry bound to a workflow definition. svc-langgraph-runner '
  'then loads the graph JSONB from ai_workflow_definitions and orchestrates nodes. '
  'Initial status=pending; runner transitions to running on first node execution.';

REVOKE ALL ON FUNCTION public.fn_create_workflow_run(uuid, jsonb, jsonb, uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.fn_create_workflow_run(uuid, jsonb, jsonb, uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.fn_create_workflow_run(uuid, jsonb, jsonb, uuid, uuid) TO service_role;
