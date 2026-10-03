-- ============================================================================
-- Source of Truth: lock_tooling_proposal
-- Popis: Admin manual edit guard — když admin ručně upraví AISHA-generated artifact,
--        nastaví manual_locked=true aby AISHA artifact znovu nepřepsala při dalším
--        cycle. "Lidský dotek" gate.
-- Volá: dashboard admin button, manual SQL by admin
-- Auth: admin only (changes AISHA's autonomous behavior)
-- ============================================================================

CREATE OR REPLACE FUNCTION public.lock_tooling_proposal(
  p_artifact_path text,
  p_locked        boolean DEFAULT true
)
RETURNS public.aisha_tooling_proposals
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_row public.aisha_tooling_proposals;
BEGIN
  -- Admin only (this changes AISHA's autonomous behavior)
  IF NOT public.is_user_admin() THEN
    RAISE EXCEPTION 'Admin role required';
  END IF;

  UPDATE public.aisha_tooling_proposals
  SET manual_locked = p_locked,
      updated_at = now()
  WHERE artifact_path = p_artifact_path
  RETURNING * INTO v_row;

  IF v_row IS NULL THEN
    RAISE EXCEPTION 'Proposal not found for path: %', p_artifact_path;
  END IF;

  INSERT INTO public.audit_journal (user_id, action, metadata)
  VALUES (
    auth.uid(),
    'aisha_tooling_lock_changed',
    jsonb_build_object(
      'proposal_id', v_row.id,
      'artifact_path', p_artifact_path,
      'locked', p_locked
    )
  );

  RETURN v_row;
END;
$$;

REVOKE ALL ON FUNCTION public.lock_tooling_proposal(text, boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.lock_tooling_proposal(text, boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.lock_tooling_proposal(text, boolean) TO service_role;
