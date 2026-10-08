-- ============================================================================
-- Source of Truth: update_tooling_proposal_status
-- Popis: State transition pro tooling proposal. Validates approval_status enum.
--        Při 'approved' nastavuje approved_at + approved_by. Při 'committed'
--        nastavuje committed_sha + committed_at. Loguje do audit_journal.
-- Volá: WF_APPROVAL_GATE callback, WF_AISHA_TOOLING_COMMITTER po GitHub PR commitu
-- Auth: service_role nebo admin/staff
-- ============================================================================

CREATE OR REPLACE FUNCTION public.update_tooling_proposal_status(
  p_proposal_id    uuid,
  p_new_status     text,
  p_committed_sha  text DEFAULT NULL,
  p_reverted_sha   text DEFAULT NULL
)
RETURNS public.aisha_tooling_proposals
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_row public.aisha_tooling_proposals;
  v_is_service boolean;
BEGIN
  v_is_service := public.is_service_role();
  IF NOT v_is_service AND NOT public.is_admin_or_staff() THEN
    RAISE EXCEPTION 'Unauthorized' USING ERRCODE = '22023';
  END IF;

  IF p_new_status NOT IN ('pending', 'approved', 'rejected', 'expired', 'committed', 'reverted') THEN
    RAISE EXCEPTION 'Invalid status: %', p_new_status USING ERRCODE = '22023';
  END IF;

  UPDATE public.aisha_tooling_proposals
  SET approval_status = p_new_status,
      approved_at     = CASE WHEN p_new_status = 'approved' THEN now() ELSE approved_at END,
      approved_by     = CASE WHEN p_new_status = 'approved' THEN auth.uid() ELSE approved_by END,
      committed_sha   = COALESCE(p_committed_sha, committed_sha),
      committed_at    = CASE WHEN p_new_status = 'committed' THEN now() ELSE committed_at END,
      reverted_sha    = COALESCE(p_reverted_sha, reverted_sha),
      reverted_at     = CASE WHEN p_new_status = 'reverted' THEN now() ELSE reverted_at END,
      updated_at      = now()
  WHERE id = p_proposal_id
  RETURNING * INTO v_row;

  IF v_row IS NULL THEN
    RAISE EXCEPTION 'Proposal % not found', p_proposal_id USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.audit_journal (user_id, action, metadata)
  VALUES (
    auth.uid(),
    'aisha_tooling_status_updated',
    jsonb_build_object(
      'proposal_id', p_proposal_id,
      'new_status', p_new_status,
      'committed_sha', p_committed_sha,
      'reverted_sha', p_reverted_sha
    )
  );

  RETURN v_row;
END;
$$;

REVOKE ALL ON FUNCTION public.update_tooling_proposal_status(uuid, text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.update_tooling_proposal_status(uuid, text, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.update_tooling_proposal_status(uuid, text, text, text) TO service_role;
