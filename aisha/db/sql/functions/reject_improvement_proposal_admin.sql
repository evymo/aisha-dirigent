-- Function: reject_improvement_proposal_admin
-- Reject an improvement proposal with optional review note.
-- Source: migration 20260418130000_fix_self_improvement_foundation.sql

CREATE OR REPLACE FUNCTION public.reject_improvement_proposal_admin(
  p_proposal_id uuid,
  p_review_note text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_proposal record;
BEGIN
  IF NOT is_admin_or_staff() THEN
    RAISE EXCEPTION 'Unauthorized' USING ERRCODE = 'P0003';
  END IF;

  SELECT * INTO v_proposal
  FROM improvement_proposals
  WHERE id = p_proposal_id AND status IN ('pending', 'pending_review', 'draft', 'auto_approved')
  FOR UPDATE;

  IF v_proposal IS NULL THEN
    RAISE EXCEPTION 'Proposal not found or not in reviewable status' USING ERRCODE = 'P0002';
  END IF;

  UPDATE improvement_proposals
  SET reviewed_at = now(),
      reviewed_by = auth.uid(),
      review_note = p_review_note,
      status = 'rejected'
  WHERE id = p_proposal_id;

  INSERT INTO audit_journal (user_id, action, metadata)
  VALUES (auth.uid(), 'IMPROVEMENT_PROPOSAL_REJECTED', jsonb_build_object(
    'agent_slug', v_proposal.agent_slug,
    'proposal_id', p_proposal_id,
    'proposal_type', v_proposal.proposal_type
  ));

  RETURN jsonb_build_object(
    'proposal_id', p_proposal_id,
    'status', 'rejected'
  );
END;
$$;

REVOKE ALL ON FUNCTION public.reject_improvement_proposal_admin(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.reject_improvement_proposal_admin(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.reject_improvement_proposal_admin(uuid, text) TO service_role;
