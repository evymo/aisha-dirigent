-- Function: fn_rollback_agent_model
-- Rollback an agent's model configuration to the state before a proposal was applied.
-- Reads the current_value snapshot from the proposal and restores agent_catalog.
-- Source: migration 20260418130000_fix_self_improvement_foundation.sql

CREATE OR REPLACE FUNCTION public.fn_rollback_agent_model(
  p_agent_slug text,
  p_proposal_id uuid,
  p_reason text DEFAULT 'manual_rollback'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_proposal record;
  v_old_value jsonb;
BEGIN
  IF NOT is_admin_or_staff() THEN
    RAISE EXCEPTION 'Unauthorized — admin or staff required';
  END IF;

  SELECT id, agent_slug, status, category, current_value, metadata
  INTO v_proposal
  FROM improvement_proposals
  WHERE id = p_proposal_id
    AND agent_slug = p_agent_slug
    AND status = 'approved';

  IF v_proposal IS NULL THEN
    RETURN jsonb_build_object(
      'error', 'No approved proposal found for this agent',
      'proposal_id', p_proposal_id
    );
  END IF;

  v_old_value := COALESCE(v_proposal.current_value, '{}'::jsonb);

  -- Restore previous model configuration
  UPDATE agent_catalog
  SET
    default_model = COALESCE(v_old_value->>'default_model', default_model),
    model_overrides = COALESCE(v_old_value->'model_overrides', model_overrides),
    updated_at = now()
  WHERE slug = p_agent_slug;

  -- Mark proposal as rolled back
  UPDATE improvement_proposals
  SET
    status = 'rolled_back',
    metadata = COALESCE(metadata, '{}'::jsonb) || jsonb_build_object(
      'rolled_back_at', now(),
      'rollback_reason', p_reason
    ),
    updated_at = now()
  WHERE id = p_proposal_id;

  -- Audit
  INSERT INTO audit_journal (user_id, action, metadata)
  VALUES (
    auth.uid(),
    'AGENT_MODEL_ROLLBACK',
    jsonb_build_object(
      'agent_slug', p_agent_slug,
      'area', 'ai',
      'proposal_id', p_proposal_id,
      'reason', p_reason,
      'restored_model', v_old_value->>'default_model',
      'severity', 'warning'
    )
  );

  RETURN jsonb_build_object(
    'agent_slug', p_agent_slug,
    'proposal_id', p_proposal_id,
    'restored_model', v_old_value->>'default_model',
    'status', 'rolled_back'
  );
END;
$$;

COMMENT ON FUNCTION fn_rollback_agent_model(text, uuid, text) IS
  'Rollback an agent model configuration to the state before a proposal was applied. '
  'Reads the current_value snapshot from the proposal and restores agent_catalog. '
  'Requires admin or staff role.';

REVOKE ALL ON FUNCTION public.fn_rollback_agent_model(text, uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.fn_rollback_agent_model(text, uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.fn_rollback_agent_model(text, uuid, text) TO service_role;
