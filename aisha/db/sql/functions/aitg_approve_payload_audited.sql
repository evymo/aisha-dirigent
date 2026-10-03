-- Function: aitg_approve_payload_audited

CREATE OR REPLACE FUNCTION public.aitg_approve_payload_audited(p_proposal_id uuid, p_status text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_proposal public.aitg_payload_proposals;
  v_new_payload_id uuid;
BEGIN
  IF NOT public.is_admin_or_staff() THEN
    RAISE EXCEPTION 'AITG_INSUFFICIENT_PRIVILEGE' USING ERRCODE = '42501';
  END IF;
  IF p_status NOT IN ('approved', 'rejected') THEN
    RAISE EXCEPTION 'AITG_INVALID_STATUS' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_proposal FROM public.aitg_payload_proposals WHERE proposal_id = p_proposal_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'AITG_PROPOSAL_NOT_FOUND' USING ERRCODE = '02000';
  END IF;
  IF v_proposal.status <> 'pending' THEN
    RAISE EXCEPTION 'AITG_PROPOSAL_ALREADY_REVIEWED' USING ERRCODE = '22023';
  END IF;

  IF p_status = 'approved' THEN
    INSERT INTO public.aitg_payloads (test_id, payload, expected_block, tags, source, active)
    VALUES (v_proposal.test_id, v_proposal.payload, v_proposal.expected_block,
            v_proposal.tags, 'aisha-proposed', true)
    RETURNING payload_id INTO v_new_payload_id;
  END IF;

  UPDATE public.aitg_payload_proposals
  SET status = p_status,
      reviewed_by = auth.uid(),
      reviewed_at = now(),
      promoted_payload_id = v_new_payload_id
  WHERE proposal_id = p_proposal_id;

  INSERT INTO public.audit_journal (user_id, action, action_type, area, severity, tags, details)
  VALUES (auth.uid(), 'aitg.payload_' || p_status, 'aitg.payload_' || p_status,
          'security', CASE p_status WHEN 'approved' THEN 'info' ELSE 'warn' END,
          ARRAY['aitg','corpus', v_proposal.test_id],
          jsonb_build_object('proposal_id', p_proposal_id, 'test_id', v_proposal.test_id,
                              'promoted_payload_id', v_new_payload_id));

  RETURN COALESCE(v_new_payload_id, p_proposal_id);
END;
$function$

;

REVOKE ALL ON FUNCTION aitg_approve_payload_audited(uuid,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION aitg_approve_payload_audited(uuid,text) TO authenticated;
