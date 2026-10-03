-- Function: execute_improvement_proposal_rollback_admin
-- Closes L5: EXECUTES a rollback of an APPLIED improvement proposal by restoring agent_catalog from
-- the pre-apply snapshot captured in improvement_proposals.current_value (written by
-- approve_improvement_proposal_admin at apply time). Mirrors that function's auth/lock/audit pattern.
-- Until now the loop only PROPOSED a rollback (advisory); this is the gated executor.
--
-- Guarded: admin/staff only. Only an 'applied' proposal with a non-empty current_value snapshot and an
-- agent_slug can be rolled back. Sets status='rolled_back'. Idempotent-ish: a non-applied proposal errors.
-- @security: admin/staff (mirrors approve_improvement_proposal_admin — human/gated, NOT service_role auto).

CREATE OR REPLACE FUNCTION public.execute_improvement_proposal_rollback_admin(
  p_proposal_id uuid DEFAULT NULL,
  p_review_note text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_proposal record;
  v_cv       jsonb;
BEGIN
  IF NOT is_admin_or_staff() THEN
    RAISE EXCEPTION 'Unauthorized' USING ERRCODE = 'P0003';
  END IF;
  IF p_proposal_id IS NULL THEN
    RAISE EXCEPTION 'proposal_id is required' USING ERRCODE = 'P0002';
  END IF;

  SELECT * INTO v_proposal
  FROM improvement_proposals
  WHERE id = p_proposal_id AND status = 'applied'
  FOR UPDATE;

  IF v_proposal IS NULL THEN
    RAISE EXCEPTION 'Proposal not found or not in applied status (only applied proposals can be rolled back)'
      USING ERRCODE = 'P0002';
  END IF;

  v_cv := COALESCE(v_proposal.current_value, '{}'::jsonb);
  IF v_proposal.agent_slug IS NULL OR v_cv = '{}'::jsonb THEN
    RAISE EXCEPTION 'No pre-apply snapshot to restore (current_value empty or agent_slug NULL)'
      USING ERRCODE = 'P0002';
  END IF;

  -- Restore the agent to its pre-apply state from the snapshot (symmetric to the apply UPDATEs).
  UPDATE agent_catalog
  SET default_model   = COALESCE(v_cv->>'default_model', default_model),
      model_overrides = COALESCE(v_cv->'model_overrides', model_overrides),
      allowed_tools   = COALESCE(
        CASE WHEN v_cv ? 'allowed_tools'
          THEN ARRAY(SELECT jsonb_array_elements_text(v_cv->'allowed_tools')) ELSE NULL END,
        allowed_tools),
      denied_tools    = COALESCE(
        CASE WHEN v_cv ? 'denied_tools'
          THEN ARRAY(SELECT jsonb_array_elements_text(v_cv->'denied_tools')) ELSE NULL END,
        denied_tools),
      updated_at      = now()
  WHERE slug = v_proposal.agent_slug;

  UPDATE improvement_proposals
  SET status      = 'rolled_back',
      review_note = COALESCE(p_review_note, review_note),
      reviewed_by = auth.uid(),
      reviewed_at = now()
  WHERE id = p_proposal_id;

  INSERT INTO audit_journal (user_id, action, metadata)
  VALUES (auth.uid(), 'IMPROVEMENT_PROPOSAL_ROLLED_BACK', jsonb_build_object(
    'agent_slug', v_proposal.agent_slug,
    'proposal_id', p_proposal_id,
    'proposal_type', v_proposal.proposal_type,
    'restored_from', 'current_value'
  ));

  RETURN jsonb_build_object(
    'proposal_id', p_proposal_id,
    'agent_slug', v_proposal.agent_slug,
    'status', 'rolled_back'
  );
END;
$$;

COMMENT ON FUNCTION public.execute_improvement_proposal_rollback_admin(uuid, text) IS
  'L5 gated rollback EXECUTOR: restores agent_catalog from the pre-apply snapshot in improvement_proposals.current_value, sets status=rolled_back, audits. admin/staff only (mirrors approve_improvement_proposal_admin).';

REVOKE ALL ON FUNCTION public.execute_improvement_proposal_rollback_admin(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.execute_improvement_proposal_rollback_admin(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.execute_improvement_proposal_rollback_admin(uuid, text) TO service_role;
