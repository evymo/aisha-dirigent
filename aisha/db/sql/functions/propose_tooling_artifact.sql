-- ============================================================================
-- Source of Truth: propose_tooling_artifact
-- Popis: Insert new AISHA-generated skill/hook/command proposal. Idempotent na
--        (proposal_kind, artifact_path) — pokud existuje pending nebo committed
--        proposal pro stejnou cestu, raises. Manual_locked artifacts cannot be
--        overwritten (admin "lidský dotek" gate).
-- Volá: WF_AISHA_TOOLING_OBSERVER po pattern detection + factory rendering
-- Auth: service_role nebo admin/staff
-- ============================================================================

CREATE OR REPLACE FUNCTION public.propose_tooling_artifact(
  p_kind                text,
  p_name                text,
  p_path                text,
  p_content             text,
  p_trigger_pattern     jsonb,
  p_occurrence_count    int,
  p_decision_provenance jsonb DEFAULT '[]'::jsonb,
  p_proposal_bundle_id  uuid DEFAULT NULL,
  p_metadata            jsonb DEFAULT '{}'::jsonb
)
RETURNS public.aisha_tooling_proposals
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_existing public.aisha_tooling_proposals;
  v_row      public.aisha_tooling_proposals;
  v_is_service boolean;
BEGIN
  v_is_service := public.is_service_role();
  IF NOT v_is_service AND NOT public.is_admin_or_staff() THEN
    RAISE EXCEPTION 'Unauthorized' USING ERRCODE = '22023';
  END IF;

  IF p_kind NOT IN ('skill', 'hook', 'command') THEN
    RAISE EXCEPTION 'Invalid kind: % (must be skill, hook, command)', p_kind USING ERRCODE = '22023';
  END IF;

  IF length(p_content) < 100 THEN
    RAISE EXCEPTION 'Artifact content too short (min 100 chars)' USING ERRCODE = '22023';
  END IF;

  -- Check for existing proposal at same path
  SELECT * INTO v_existing
  FROM public.aisha_tooling_proposals
  WHERE proposal_kind = p_kind AND artifact_path = p_path;

  IF v_existing IS NOT NULL THEN
    -- Allow overwrite only if:
    -- 1. Not manual_locked AND
    -- 2. Previous status was rejected/expired/reverted (allow re-proposal)
    IF v_existing.manual_locked THEN
      RAISE EXCEPTION 'Path % is manual-locked; AISHA cannot overwrite', p_path USING ERRCODE = '22023';
    END IF;

    IF v_existing.approval_status IN ('pending', 'approved', 'committed') THEN
      RAISE EXCEPTION 'Active proposal already exists for %: status=%',
        p_path, v_existing.approval_status USING ERRCODE = '22023';
    END IF;

    -- Update for re-proposal
    UPDATE public.aisha_tooling_proposals
    SET artifact_content = p_content,
        artifact_name = p_name,
        trigger_pattern = p_trigger_pattern,
        occurrence_count = p_occurrence_count,
        decision_provenance = p_decision_provenance,
        proposal_bundle_id = p_proposal_bundle_id,
        metadata = p_metadata,
        approval_status = 'pending',
        approval_id = NULL,
        approved_by = NULL,
        approved_at = NULL,
        committed_sha = NULL,
        committed_at = NULL,
        reverted_sha = NULL,
        reverted_at = NULL,
        proposed_at = now(),
        updated_at = now()
    WHERE id = v_existing.id
    RETURNING * INTO v_row;
  ELSE
    -- New proposal
    INSERT INTO public.aisha_tooling_proposals (
      proposal_kind, artifact_name, artifact_path, artifact_content,
      trigger_pattern, occurrence_count, decision_provenance,
      proposal_bundle_id, metadata
    )
    VALUES (
      p_kind, p_name, p_path, p_content,
      p_trigger_pattern, p_occurrence_count, p_decision_provenance,
      p_proposal_bundle_id, p_metadata
    )
    RETURNING * INTO v_row;
  END IF;

  -- Audit
  INSERT INTO public.audit_journal (user_id, action, metadata)
  VALUES (
    auth.uid(),
    'aisha_tooling_proposed',
    jsonb_build_object(
      'proposal_id', v_row.id,
      'kind', p_kind,
      'path', p_path,
      'occurrence_count', p_occurrence_count
    )
  );

  RETURN v_row;
END;
$$;

REVOKE ALL ON FUNCTION public.propose_tooling_artifact(text, text, text, text, jsonb, int, jsonb, uuid, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.propose_tooling_artifact(text, text, text, text, jsonb, int, jsonb, uuid, jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.propose_tooling_artifact(text, text, text, text, jsonb, int, jsonb, uuid, jsonb) TO service_role;
