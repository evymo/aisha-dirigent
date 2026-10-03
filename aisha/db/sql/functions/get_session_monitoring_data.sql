-- Function: get_session_monitoring_data
-- Returns audit journal entries for session monitoring (auth events)
-- Frontend: src/hooks/useSessionMonitoring.ts
-- Note: Supports both legacy (summary/details) and unified (action/metadata/new_data) audit formats.

CREATE OR REPLACE FUNCTION public.get_session_monitoring_data(
  p_user_id uuid DEFAULT NULL,
  p_ip_address text DEFAULT NULL,
  p_start_date timestamptz DEFAULT NULL,
  p_end_date timestamptz DEFAULT NULL,
  p_limit integer DEFAULT 1000
)
RETURNS TABLE (
  id uuid,
  user_id uuid,
  user_email text,
  user_role text,
  session_id text,
  ip_address text,
  user_agent text,
  created_at timestamptz,
  action text,
  metadata jsonb
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
SET search_path = public
AS $function$
BEGIN
  IF NOT public.is_admin_or_staff() THEN
    RAISE EXCEPTION 'Access denied: admin or staff role required';
  END IF;

  RETURN QUERY
  SELECT
    aj.id,
    aj.user_id,
    au.email::text AS user_email,
    COALESCE(
      aj.user_role,
      aj.details->>'user_role',
      aj.metadata->>'user_role',
      aj.new_data->>'user_role'
    )::text AS user_role,
    COALESCE(
      aj.session_id,
      aj.details->>'session_id',
      aj.metadata->>'session_id',
      aj.new_data->>'session_id',
      aj.user_id::text
    ) AS session_id,
    COALESCE(
      aj.ip_address::text,
      aj.details->>'ip_address',
      aj.metadata->>'ip_address',
      aj.new_data->>'ip_address'
    ) AS ip_address,
    COALESCE(
      aj.user_agent,
      aj.details->>'user_agent',
      aj.metadata->>'user_agent',
      aj.new_data->>'user_agent'
    ) AS user_agent,
    aj.created_at,
    COALESCE(aj.action, aj.summary) AS action,
    COALESCE(aj.details, aj.metadata, aj.new_data, '{}'::jsonb) AS metadata
  FROM public.audit_journal aj
  LEFT JOIN aisha_auth.users au ON au.id = aj.user_id
  WHERE
    (
      LOWER(COALESCE(aj.action, aj.summary, '')) IN (
        'login',
        'logout',
        'session_start',
        'session_refresh',
        'phi_access',
        'api_request'
      )
      OR COALESCE(aj.details, aj.metadata, aj.new_data, '{}'::jsonb)->>'area' IN ('auth', 'session')
      OR LOWER(COALESCE(aj.action, aj.summary, '')) LIKE '%login%'
      OR LOWER(COALESCE(aj.action, aj.summary, '')) LIKE '%session%'
    )
    AND (p_user_id IS NULL OR aj.user_id = p_user_id)
    AND (
      p_ip_address IS NULL
      OR COALESCE(
        aj.ip_address::text,
        aj.details->>'ip_address',
        aj.metadata->>'ip_address',
        aj.new_data->>'ip_address'
      ) = p_ip_address
    )
    AND (p_start_date IS NULL OR aj.created_at >= p_start_date)
    AND (p_end_date IS NULL OR aj.created_at <= p_end_date)
  ORDER BY aj.created_at DESC
  LIMIT p_limit;
END;
$function$;

-- Permissions
REVOKE ALL ON FUNCTION public.get_session_monitoring_data(uuid, text, timestamptz, timestamptz, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_session_monitoring_data(uuid, text, timestamptz, timestamptz, integer) TO authenticated;
