-- Function: public.get_audit_journal
-- Arguments: p_limit, p_action_type, p_area, p_severity, p_entity_type, p_start_date, p_end_date, p_search
-- Description: Get audit journal entries with filtering. Admin/staff only.
-- Security: SECURITY DEFINER, admin/staff only.

CREATE OR REPLACE FUNCTION public.get_audit_journal(
  p_limit INTEGER DEFAULT 100,
  p_action_type TEXT DEFAULT NULL,
  p_area TEXT DEFAULT NULL,
  p_severity TEXT DEFAULT NULL,
  p_entity_type TEXT DEFAULT NULL,
  p_start_date TIMESTAMPTZ DEFAULT NULL,
  p_end_date TIMESTAMPTZ DEFAULT NULL,
  p_search TEXT DEFAULT NULL
)
RETURNS TABLE (
  id UUID,
  user_id UUID,
  user_email TEXT,
  user_role TEXT,
  action_type TEXT,
  entity_type TEXT,
  entity_id TEXT,
  area TEXT,
  severity TEXT,
  summary TEXT,
  details JSONB,
  old_values JSONB,
  new_values JSONB,
  blockchain_hash TEXT,
  blockchain_tx_hash TEXT,
  blockchain_status TEXT,
  tags TEXT[],
  created_at TIMESTAMPTZ
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  IF NOT public.is_admin_or_staff() THEN
    RAISE EXCEPTION 'Access denied: admin or staff role required';
  END IF;

  RETURN QUERY
  SELECT
    aj.id,
    aj.user_id,
    COALESCE(au.email::text, aj.user_email) AS user_email,
    aj.user_role,
    aj.action_type,
    aj.entity_type,
    aj.entity_id,
    aj.area,
    aj.severity,
    aj.summary,
    aj.details,
    aj.old_values,
    aj.new_values,
    aj.blockchain_hash,
    aj.blockchain_tx_hash,
    aj.blockchain_status,
    aj.tags,
    aj.created_at
  FROM public.audit_journal aj
  LEFT JOIN aisha_auth.users au ON au.id = aj.user_id
  WHERE (p_action_type IS NULL OR aj.action_type::text = p_action_type)
    AND (p_area IS NULL OR aj.area::text = p_area)
    AND (p_severity IS NULL OR aj.severity::text = p_severity)
    AND (p_entity_type IS NULL OR aj.entity_type = p_entity_type)
    AND (p_start_date IS NULL OR aj.created_at >= p_start_date)
    AND (p_end_date IS NULL OR aj.created_at <= p_end_date)
    AND (p_search IS NULL OR
         aj.action_type::text ILIKE '%' || p_search || '%' OR
         aj.entity_type ILIKE '%' || p_search || '%' OR
         aj.summary ILIKE '%' || p_search || '%' OR
         COALESCE(au.email, aj.user_email) ILIKE '%' || p_search || '%')
  ORDER BY aj.created_at DESC
  LIMIT p_limit;
END;
$function$;

COMMENT ON FUNCTION public.get_audit_journal(integer, text, text, text, text, timestamptz, timestamptz, text) IS
  'Get audit journal entries with filtering. Admin/staff only.';

-- Permissions (admin/staff only via function check)
REVOKE ALL ON FUNCTION public.get_audit_journal(INTEGER, TEXT, TEXT, TEXT, TEXT, TIMESTAMPTZ, TIMESTAMPTZ, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_audit_journal(INTEGER, TEXT, TEXT, TEXT, TEXT, TIMESTAMPTZ, TIMESTAMPTZ, TEXT) TO authenticated;
