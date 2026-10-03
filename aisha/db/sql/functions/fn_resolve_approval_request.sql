-- Function: public.fn_resolve_approval_request
-- Persists an approval DECISION raised by WF_APPROVAL_GATE (Resolve Approval
-- node). Records the human/operator decision + comment + responder against an
-- existing request in the approval_requests ledger and transitions its status.
-- Security: SECURITY DEFINER (service_role-invoked via aishaRpc), search_path pinned.

CREATE OR REPLACE FUNCTION public.fn_resolve_approval_request(
  p_approval_id  uuid,
  p_decision     text,
  p_responded_by text DEFAULT NULL,
  p_comment      text DEFAULT NULL,
  p_responded_at timestamptz DEFAULT now()
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_status text;
BEGIN
  IF p_approval_id IS NULL THEN
    RAISE EXCEPTION 'approval_id is required' USING ERRCODE = 'check_violation';
  END IF;

  -- Normalise the decision to the request lifecycle status.
  v_status := CASE lower(COALESCE(p_decision, ''))
    WHEN 'approve'  THEN 'approved'
    WHEN 'approved' THEN 'approved'
    WHEN 'reject'   THEN 'rejected'
    WHEN 'rejected' THEN 'rejected'
    WHEN 'deny'     THEN 'rejected'
    WHEN 'denied'   THEN 'rejected'
    WHEN 'cancel'   THEN 'cancelled'
    WHEN 'cancelled' THEN 'cancelled'
    WHEN 'expire'   THEN 'expired'
    WHEN 'expired'  THEN 'expired'
    ELSE 'rejected' -- fail-closed: an unrecognised decision is not an approval
  END;

  UPDATE public.approval_requests
     SET decision     = p_decision,
         status       = v_status,
         responded_by = p_responded_by,
         responded_at = COALESCE(p_responded_at, now()),
         updated_at   = now()
   WHERE id = p_approval_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Approval request not found: %', p_approval_id USING ERRCODE = 'no_data_found';
  END IF;

  INSERT INTO public.audit_journal
    (user_id, action_type, action, entity_type, entity_id, area, severity, summary, details)
  VALUES
    (NULL, 'approval', 'APPROVAL_RESOLVED', 'approval_request', p_approval_id::text,
     'system', 'info',
     format('Approval request %s', v_status),
     jsonb_build_object('decision', p_decision, 'status', v_status, 'responded_by', p_responded_by));

  RETURN jsonb_build_object(
    'approval_id', p_approval_id,
    'status', v_status,
    'decision', p_decision
  );
END;
$function$;

COMMENT ON FUNCTION public.fn_resolve_approval_request(uuid, text, text, text, timestamptz) IS
  'Records a WF_APPROVAL_GATE decision onto approval_requests (fail-closed status normalisation).';

REVOKE ALL ON FUNCTION public.fn_resolve_approval_request(uuid, text, text, text, timestamptz) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_resolve_approval_request(uuid, text, text, text, timestamptz) TO service_role;
