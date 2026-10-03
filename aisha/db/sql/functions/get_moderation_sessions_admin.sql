-- Function: get_moderation_sessions_admin
-- Description: List moderation sessions with aggregated decision counts. Admin/staff only.
-- Security: SECURITY DEFINER with search_path set. Uses is_admin_or_staff() check.

CREATE OR REPLACE FUNCTION public.get_moderation_sessions_admin(
  p_limit integer DEFAULT 50,
  p_offset integer DEFAULT 0,
  p_status text DEFAULT NULL,
  p_session_type text DEFAULT NULL
)
RETURNS TABLE(
  id uuid,
  story_id uuid,
  user_id uuid,
  session_type text,
  expertise_level text,
  tech_stack jsonb,
  status text,
  metadata jsonb,
  decision_count bigint,
  critical_count bigint,
  created_at timestamptz,
  updated_at timestamptz
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
    ms.id,
    ms.story_id,
    ms.user_id,
    ms.session_type,
    ms.expertise_level,
    ms.tech_stack,
    ms.status,
    ms.metadata,
    COALESCE(dc.cnt, 0) AS decision_count,
    COALESCE(dc.crit, 0) AS critical_count,
    ms.created_at,
    ms.updated_at
  FROM moderation_sessions ms
  LEFT JOIN LATERAL (
    SELECT
      count(*) AS cnt,
      count(*) FILTER (WHERE md.severity IN ('error', 'critical')) AS crit
    FROM moderation_decisions md
    WHERE md.session_id = ms.id
  ) dc ON true
  WHERE (p_status IS NULL OR ms.status = p_status)
    AND (p_session_type IS NULL OR ms.session_type = p_session_type)
  ORDER BY ms.created_at DESC
  LIMIT p_limit
  OFFSET p_offset;
END;
$function$;

-- Permissions
REVOKE ALL ON FUNCTION public.get_moderation_sessions_admin(integer, integer, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_moderation_sessions_admin(integer, integer, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_moderation_sessions_admin(integer, integer, text, text) TO service_role;
