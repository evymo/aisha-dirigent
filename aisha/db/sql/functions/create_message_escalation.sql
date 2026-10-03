-- Function: public.create_message_escalation
-- Arguments: p_message_id uuid, p_conversation_id uuid, p_partner_id uuid, p_escalation_type text, p_user_note text, p_context_messages jsonb
-- Security: See function definition below.
-- Extracted: 2026-01-08T18:26:05+01:00

CREATE OR REPLACE FUNCTION public.create_message_escalation(p_message_id uuid, p_conversation_id uuid, p_partner_id uuid, p_escalation_type text, p_user_note text DEFAULT NULL::text, p_context_messages jsonb DEFAULT '[]'::jsonb)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_user_id UUID := auth.uid();
  v_escalation_id UUID;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  INSERT INTO message_escalations (
    message_id,
    conversation_id,
    user_id,
    partner_id,
    escalation_type,
    user_note,
    context_messages
  ) VALUES (
    p_message_id,
    p_conversation_id,
    v_user_id,
    p_partner_id,
    p_escalation_type,
    p_user_note,
    p_context_messages
  )
  RETURNING id INTO v_escalation_id;

  INSERT INTO audit_journal (
    action, user_id, action_type, area, entity_type, entity_id, summary, severity
  ) VALUES (
    'CREATE_MESSAGE_ESCALATION', v_user_id, 'create', 'member', 'message_escalation', v_escalation_id,
    'Created message escalation of type: ' || p_escalation_type, 'info'
  );

  RETURN v_escalation_id;
END;
$function$
;

-- Permissions
REVOKE ALL ON FUNCTION public.create_message_escalation(p_message_id uuid, p_conversation_id uuid, p_partner_id uuid, p_escalation_type text, p_user_note text, p_context_messages jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.create_message_escalation(p_message_id uuid, p_conversation_id uuid, p_partner_id uuid, p_escalation_type text, p_user_note text, p_context_messages jsonb) TO authenticated;
