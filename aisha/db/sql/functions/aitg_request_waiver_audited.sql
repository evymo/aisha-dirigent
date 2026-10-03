-- ============================================================================
-- Function: aitg_request_waiver_audited
-- Purpose: Aisha or a human requests a time-bound waiver for a failing test.
--          The function INSERTS the waiver but only an admin can actually
--          approve it via approved_by — service_role calls leave approved_by
--          set to a marker UUID and the row is "pending" until human flips it
--          to approved.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.aitg_request_waiver_audited(
  p_test_id       text,
  p_scope         jsonb,
  p_justification text,
  p_expires_at    timestamptz
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_is_service_role boolean;
  v_approver        uuid;
  v_waiver_id       uuid;
BEGIN
  v_is_service_role := public.is_service_role();
  IF NOT v_is_service_role AND NOT public.is_admin_or_staff() THEN
    RAISE EXCEPTION 'AITG_INSUFFICIENT_PRIVILEGE' USING ERRCODE = '42501';
  END IF;

  IF p_expires_at <= now() THEN
    RAISE EXCEPTION 'AITG_WAIVER_EXPIRY_IN_PAST' USING ERRCODE = '22023';
  END IF;
  IF p_expires_at > now() + interval '90 days' THEN
    RAISE EXCEPTION 'AITG_WAIVER_EXPIRY_TOO_FAR' USING ERRCODE = '22023';
  END IF;

  -- approved_by is required NOT NULL on the table; for self-service requests
  -- we set the requester (admin) or a system marker for service_role.
  v_approver := COALESCE(auth.uid(),
    (SELECT id FROM aisha_auth.users WHERE email LIKE 'system@%' LIMIT 1));
  IF v_approver IS NULL THEN
    RAISE EXCEPTION 'AITG_WAIVER_NO_APPROVER' USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.aitg_waivers (test_id, scope, justification, approved_by, expires_at)
  VALUES (p_test_id, p_scope, p_justification, v_approver, p_expires_at)
  RETURNING waiver_id INTO v_waiver_id;

  INSERT INTO public.audit_journal (user_id, action, action_type, area, severity, tags, details)
  VALUES (auth.uid(), 'aitg.waiver_requested', 'aitg.waiver_requested', 'security', 'warn',
          ARRAY['aitg', 'waiver', p_test_id],
          jsonb_build_object('waiver_id', v_waiver_id, 'test_id', p_test_id,
                             'expires_at', p_expires_at,
                             'requested_by_service_role', v_is_service_role));

  RETURN v_waiver_id;
END;
$$;

REVOKE ALL ON FUNCTION public.aitg_request_waiver_audited(text, jsonb, text, timestamptz) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.aitg_request_waiver_audited(text, jsonb, text, timestamptz) TO authenticated;
GRANT EXECUTE ON FUNCTION public.aitg_request_waiver_audited(text, jsonb, text, timestamptz) TO service_role;
