-- Function: update_ai_run_status
-- Updates the status of an ai_run with lifecycle transition validation.
-- Pipeline Executor calls this after each agent step.

CREATE OR REPLACE FUNCTION public.update_ai_run_status(
  p_metadata jsonb DEFAULT '{}'::jsonb,
  p_run_id uuid DEFAULT NULL,
  p_status text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_current_status text;
  v_valid_transitions jsonb := '{
    "running": ["completed", "failed", "blocked", "awaiting_approval"],
    "awaiting_approval": ["running", "completed", "failed", "blocked"],
    "blocked": ["running", "failed"]
  }'::jsonb;
  v_allowed text[];
BEGIN
  -- Validate inputs
  IF p_run_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'p_run_id is required');
  END IF;
  IF p_status IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'p_status is required');
  END IF;

  -- Get current status
  SELECT status INTO v_current_status
  FROM ai_runs
  WHERE id = p_run_id;

  IF v_current_status IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Run not found');
  END IF;

  -- Check if transition is valid
  SELECT ARRAY(
    SELECT jsonb_array_elements_text(v_valid_transitions -> v_current_status)
  ) INTO v_allowed;

  IF v_allowed IS NULL OR NOT (p_status = ANY(v_allowed)) THEN
    RETURN jsonb_build_object(
      'ok', false,
      'error', format('Invalid transition: %s → %s', v_current_status, p_status),
      'allowed', to_jsonb(COALESCE(v_allowed, ARRAY[]::text[]))
    );
  END IF;

  -- Update the run
  UPDATE ai_runs
  SET
    status = p_status,
    finished_at = CASE
      WHEN p_status IN ('completed', 'failed') THEN now()
      ELSE finished_at
    END,
    metadata = metadata || p_metadata || jsonb_build_object(
      'last_status_change', jsonb_build_object(
        'from', v_current_status,
        'to', p_status,
        'at', now()::text
      )
    )
  WHERE id = p_run_id;

  -- Audit log
  INSERT INTO audit_journal (user_id, action, metadata)
  VALUES (
    auth.uid(),
    'AI_RUN_STATUS_UPDATE',
    jsonb_build_object(
      'area', 'ai_orchestration',
      'severity', 'info',
      'entity_type', 'ai_run',
      'entity_id', p_run_id::text,
      'from_status', v_current_status,
      'to_status', p_status
    )
  );

  RETURN jsonb_build_object(
    'ok', true,
    'run_id', p_run_id,
    'previous_status', v_current_status,
    'new_status', p_status
  );
END;
$$;

-- Permissions
REVOKE ALL ON FUNCTION public.update_ai_run_status(jsonb, uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.update_ai_run_status(jsonb, uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.update_ai_run_status(jsonb, uuid, text) TO service_role;

COMMENT ON FUNCTION public.update_ai_run_status(jsonb, uuid, text) IS
  'Updates ai_run status with lifecycle validation. '
  'Valid transitions: running→completed/failed/blocked/awaiting_approval, '
  'awaiting_approval→running/completed/failed/blocked, blocked→running/failed.';
