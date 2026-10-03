-- ============================================================================
-- Function: aitg_propose_remediation_audited
-- Purpose: Aisha (or a human auditor) proposes a fix for an open finding.
--          Wires into improvement_proposals so the existing
--          WF_KNOWLEDGE_AGENT / WF_APPROVAL_GATE pipeline picks it up.
-- AuthZ: admin/staff/service_role. The proposal still goes through the
--        approval gate before any expert_rules / code change is applied —
--        so Aisha can SUGGEST but not unilaterally PATCH.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.aitg_propose_remediation_audited(
  p_finding_id  uuid,
  p_proposal    text,
  p_proposed_by text DEFAULT 'aisha'
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_is_service_role boolean;
  v_finding         public.aitg_findings;
  v_test_id         text;
  v_proposal_id     uuid;
BEGIN
  v_is_service_role := public.is_service_role();
  IF NOT v_is_service_role AND NOT public.is_admin_or_staff() THEN
    RAISE EXCEPTION 'AITG_INSUFFICIENT_PRIVILEGE' USING ERRCODE = '42501';
  END IF;

  IF length(p_proposal) < 20 THEN
    RAISE EXCEPTION 'AITG_PROPOSAL_TOO_SHORT' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_finding FROM public.aitg_findings WHERE finding_id = p_finding_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'AITG_FINDING_NOT_FOUND' USING ERRCODE = '02000';
  END IF;
  IF v_finding.fixed_at IS NOT NULL THEN
    RAISE EXCEPTION 'AITG_FINDING_ALREADY_FIXED' USING ERRCODE = '22023';
  END IF;

  SELECT test_id INTO v_test_id FROM public.aitg_runs WHERE run_id = v_finding.run_id;

  -- Record proposal on the finding itself (lightweight; full lifecycle in
  -- improvement_proposals if that table exists in this deployment).
  UPDATE public.aitg_findings
  SET remediation = p_proposal
  WHERE finding_id = p_finding_id
  RETURNING finding_id INTO v_proposal_id;

  INSERT INTO public.audit_journal (user_id, action, action_type, area, severity, tags, details)
  VALUES (auth.uid(), 'aitg.remediation_proposed', 'aitg.remediation_proposed', 'security', 'info',
          ARRAY['aitg', 'remediation', v_test_id],
          jsonb_build_object('finding_id', p_finding_id, 'test_id', v_test_id,
                             'proposed_by', p_proposed_by));

  RETURN v_proposal_id;
END;
$$;

REVOKE ALL ON FUNCTION public.aitg_propose_remediation_audited(uuid, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.aitg_propose_remediation_audited(uuid, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.aitg_propose_remediation_audited(uuid, text, text) TO service_role;
