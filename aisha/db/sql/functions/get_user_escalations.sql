-- Function: public.get_user_escalations
-- Arguments: p_user_id uuid
-- Security: See function definition below.
-- Extracted: 2026-01-08T18:27:46+01:00

CREATE OR REPLACE FUNCTION public.get_user_escalations(p_user_id uuid)
 RETURNS TABLE(conversation_id uuid, created_at timestamptz, escalation_type text, id uuid, message_id uuid, partner_id uuid, partner_response text, partner_responded_at timestamptz, priority text, status text, user_note text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  -- User can only see their own escalations
  IF auth.uid() IS NULL OR auth.uid() != p_user_id THEN
    RAISE EXCEPTION 'Access denied';
  END IF;

  RETURN QUERY
  SELECT
    me.conversation_id,
    me.created_at,
    me.escalation_type,
    me.id,
    me.message_id,
    me.partner_id,
    me.partner_response,
    me.partner_responded_at,
    me.priority,
    me.status,
    me.user_note
  FROM message_escalations me
  WHERE me.user_id = p_user_id
  ORDER BY me.created_at DESC
  LIMIT 50;
END;
$function$
;

-- Permissions
REVOKE ALL ON FUNCTION public.get_user_escalations(p_user_id uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_user_escalations(p_user_id uuid) TO authenticated;
