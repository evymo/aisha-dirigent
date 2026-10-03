-- Function: public.get_audit_journal_summary
-- Arguments: p_limit integer, p_offset integer
-- Description: Returns audit journal summary for admin dashboard.
-- Security: SECURITY DEFINER, admin-only
-- Note: Returns 'action' (from action_type) and 'metadata' (from details) for API compatibility

CREATE OR REPLACE FUNCTION public.get_audit_journal_summary(p_limit integer DEFAULT 100, p_offset integer DEFAULT 0)
 RETURNS TABLE(
   id uuid, 
   created_at timestamp with time zone, 
   user_email text, 
   user_role text, 
   action text, 
   entity_type text, 
   entity_id text, 
   area text, 
   severity text, 
   summary text, 
   blockchain_status text, 
   blockchain_tx_hash text,
   metadata jsonb
 )
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  -- Only admins can access audit journal
  IF NOT has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'Access denied: admin role required';
  END IF;
  
  RETURN QUERY
  SELECT 
    aj.id, 
    aj.created_at, 
    aj.user_email, 
    aj.user_role, 
    aj.action_type::text AS action,
    COALESCE(aj.details->>'entity_type', aj.entity_type)::text AS entity_type, 
    COALESCE(aj.details->>'entity_id', aj.entity_id)::text AS entity_id, 
    COALESCE(aj.details->>'area', aj.area::text)::text AS area, 
    COALESCE(aj.details->>'severity', aj.severity::text)::text AS severity, 
    aj.summary,
    aj.blockchain_status, 
    aj.blockchain_tx_hash,
    aj.details AS metadata
  FROM audit_journal aj
  ORDER BY aj.created_at DESC
  LIMIT p_limit OFFSET p_offset;
END;
$function$
;

-- Permissions
REVOKE ALL ON FUNCTION public.get_audit_journal_summary(p_limit integer, p_offset integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_audit_journal_summary(p_limit integer, p_offset integer) TO authenticated;
