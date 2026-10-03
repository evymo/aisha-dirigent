-- Function: aitg_propose_payload_audited

CREATE OR REPLACE FUNCTION public.aitg_propose_payload_audited(p_test_id text, p_payload jsonb, p_expected_block text, p_justification text, p_tags text[] DEFAULT '{}'::text[], p_proposed_by text DEFAULT 'aisha'::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_is_service boolean;
  v_id uuid;
BEGIN
  v_is_service := public.is_service_role();
  IF NOT v_is_service AND NOT public.is_admin_or_staff() THEN
    RAISE EXCEPTION 'AITG_INSUFFICIENT_PRIVILEGE' USING ERRCODE = '42501';
  END IF;
  IF length(p_justification) < 20 THEN
    RAISE EXCEPTION 'AITG_PROPOSAL_JUSTIFICATION_TOO_SHORT' USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.aitg_payload_proposals (
    test_id, payload, expected_block, tags, justification, proposed_by
  ) VALUES (
    p_test_id, p_payload, p_expected_block, p_tags, p_justification, p_proposed_by
  )
  RETURNING proposal_id INTO v_id;

  INSERT INTO public.audit_journal (user_id, action, action_type, area, severity, tags, details)
  VALUES (auth.uid(), 'aitg.payload_proposed', 'aitg.payload_proposed', 'security', 'info',
          ARRAY['aitg','corpus', p_test_id],
          jsonb_build_object('proposal_id', v_id, 'test_id', p_test_id,
                              'proposed_by', p_proposed_by));
  RETURN v_id;
END;
$function$

;

REVOKE ALL ON FUNCTION aitg_propose_payload_audited(text,jsonb,text,text,text[],text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION aitg_propose_payload_audited(text,jsonb,text,text,text[],text) TO authenticated;
GRANT EXECUTE ON FUNCTION aitg_propose_payload_audited(text,jsonb,text,text,text[],text) TO service_role;
