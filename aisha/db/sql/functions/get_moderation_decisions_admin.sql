-- Function: get_moderation_decisions_admin
-- Description: Get moderation decisions for a given session. Admin/staff only.
-- Security: SECURITY DEFINER with search_path set. Uses is_admin_or_staff() check.

CREATE OR REPLACE FUNCTION public.get_moderation_decisions_admin(
  p_session_id uuid
)
RETURNS TABLE(
  id uuid,
  session_id uuid,
  decision_type text,
  severity text,
  context jsonb,
  recommendation text,
  evidence jsonb,
  accepted boolean,
  created_at timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  IF NOT is_admin_or_staff() THEN
    RAISE EXCEPTION 'Permission denied' USING ERRCODE = 'P0003';
  END IF;

  RETURN QUERY
  SELECT
    md.id,
    md.session_id,
    md.decision_type,
    md.severity,
    md.context,
    md.recommendation,
    md.evidence,
    md.accepted,
    md.created_at
  FROM moderation_decisions md
  WHERE md.session_id = p_session_id
  ORDER BY md.created_at ASC;
END;
$function$;

-- Permissions
REVOKE ALL ON FUNCTION public.get_moderation_decisions_admin(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_moderation_decisions_admin(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_moderation_decisions_admin(uuid) TO service_role;
