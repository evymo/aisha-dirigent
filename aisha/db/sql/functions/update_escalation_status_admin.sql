-- Function: public.update_escalation_status_admin
-- Arguments: p_escalation_id uuid, p_status text
-- Security: See function definition below.
-- Extracted: 2026-01-08T18:28:18+01:00

CREATE OR REPLACE FUNCTION public.update_escalation_status_admin(p_escalation_id uuid, p_status text)
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
    status = p_status,
    updated_at = NOW()
  WHERE id = p_escalation_id;

  -- Audit log
  PERFORM public.write_audit_journal(
      p_action_type := 'update'::public.journal_action_type,
      p_area := 'admin'::public.journal_area,
      p_details := NULL,
      p_entity_id := p_escalation_id::text,
      p_entity_type := 'escalation_status',
      p_new_values := jsonb_build_object('escalation_id', p_escalation_id, 'status', p_status),
      p_old_values := NULL,
      p_severity := 'info'::public.journal_severity,
      p_summary := 'Admin updated escalation status',
      p_tags := ARRAY['admin', 'escalation_status', 'update'],
      p_user_id := auth.uid()
  );

END;
$function$
;

-- Permissions
REVOKE ALL ON FUNCTION public.update_escalation_status_admin(p_escalation_id uuid, p_status text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.update_escalation_status_admin(p_escalation_id uuid, p_status text) TO authenticated;
