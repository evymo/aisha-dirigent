-- Function: public.get_partner_escalations
-- Arguments: p_partner_id uuid
-- Security: See function definition below.
-- Extracted: 2026-01-08T18:27:11+01:00

CREATE OR REPLACE FUNCTION public.get_partner_escalations(p_partner_id uuid)
 RETURNS TABLE(context_messages jsonb, conversation_id uuid, created_at timestamptz, escalation_type text, id uuid, message_id uuid, partner_id uuid, partner_response text, partner_responded_at timestamptz, priority text, status text, user_note text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_user_id UUID := auth.uid();
BEGIN
  -- Verify the user is the partner or admin
  IF NOT EXISTS (
    SELECT 1 FROM partner_profiles pp
    WHERE pp.id = p_partner_id AND pp.user_id = v_user_id
  ) AND NOT is_admin_or_staff(v_user_id) THEN
    RAISE EXCEPTION 'Access denied';
  END IF;

  RETURN QUERY
  SELECT
    me.context_messages,
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
  WHERE me.partner_id = p_partner_id
    AND me.status IN ('pending', 'viewed', 'in_progress')
  ORDER BY 
    CASE me.priority 
      WHEN 'urgent' THEN 1 
      WHEN 'high' THEN 2 
      WHEN 'normal' THEN 3 
      WHEN 'low' THEN 4 
      ELSE 5 
    END,
    me.created_at ASC
  LIMIT 100;
END;
$function$
;

-- Permissions
REVOKE ALL ON FUNCTION public.get_partner_escalations(p_partner_id uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_partner_escalations(p_partner_id uuid) TO authenticated;
