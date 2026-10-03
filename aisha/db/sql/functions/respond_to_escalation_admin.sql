-- Function: public.respond_to_escalation_admin
-- Arguments: p_escalation_id uuid, p_response text, p_new_status text
-- Security: See function definition below.
-- Extracted: 2026-01-08T18:28:01+01:00

CREATE OR REPLACE FUNCTION public.respond_to_escalation_admin(p_escalation_id uuid, p_response text, p_new_status text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_user_id UUID := auth.uid();
  v_partner_id UUID;
BEGIN
  -- Get the partner_id for this escalation and verify access
  SELECT me.partner_id INTO v_partner_id
  FROM message_escalations me
  WHERE me.id = p_escalation_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Escalation not found';
  END IF;

  -- Verify the user is the partner or admin
  IF NOT EXISTS (
    SELECT 1 FROM partner_profiles pp
    WHERE pp.id = v_partner_id AND pp.user_id = v_user_id
  ) AND NOT is_admin_or_staff(v_user_id) THEN
    RAISE EXCEPTION 'Access denied';
  END IF;

  UPDATE message_escalations SET
    partner_response = p_response,
    partner_responded_at = NOW(),
    status = p_new_status,
    resolved_at = CASE WHEN p_new_status = 'resolved' THEN NOW() ELSE NULL END,
    updated_at = NOW()
  WHERE id = p_escalation_id;

  -- Log to audit journal
  INSERT INTO audit_journal (
    user_id, action_type, area, entity_type, entity_id, summary, severity
  ) VALUES (
    v_user_id, 'update', 'partner', 'message_escalation', p_escalation_id,
    'Partner responded to escalation, new status: ' || p_new_status, 'info'
  );
END;
$function$
;

-- Permissions
REVOKE ALL ON FUNCTION public.respond_to_escalation_admin(p_escalation_id uuid, p_response text, p_new_status text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.respond_to_escalation_admin(p_escalation_id uuid, p_response text, p_new_status text) TO authenticated;
