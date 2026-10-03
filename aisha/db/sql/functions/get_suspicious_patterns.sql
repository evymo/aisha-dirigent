-- Function: get_suspicious_patterns
-- Returns suspicious activity patterns from audit journal
-- Frontend: src/hooks/useSessionMonitoring.ts (useSuspiciousPatterns)
-- Note: Returns 'metadata' (from details) for API compatibility

CREATE OR REPLACE FUNCTION public.get_suspicious_patterns(
  p_resolved boolean DEFAULT NULL,
  p_severity text DEFAULT NULL,
  p_limit integer DEFAULT 50
)
RETURNS TABLE (
  id uuid,
  user_id uuid,
  user_email text,
  ip_address text,
  created_at timestamptz,
  metadata jsonb,
  severity text,
  tags text[],
  resolved_at timestamptz,
  resolved_by uuid,
  resolution_notes text
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
    (aj.details->>'ip_address')::text AS ip_address,
    aj.created_at,
    aj.details AS metadata,
    COALESCE(aj.details->>'severity', 'medium')::text AS severity,
    aj.tags,
    ser.resolved_at,
    ser.resolved_by,
    ser.resolution_notes
  FROM public.audit_journal aj
  LEFT JOIN aisha_auth.users au ON au.id = aj.user_id
  LEFT JOIN public.security_event_resolutions ser ON ser.audit_journal_id = aj.id
  WHERE 
    (aj.details->>'severity' IN ('warning', 'error', 'critical', 'high', 'medium')
     OR 'suspicious' = ANY(aj.tags)
     OR 'brute_force' = ANY(aj.tags)
     OR 'geo_anomaly' = ANY(aj.tags)
     OR 'rate_limit' = ANY(aj.tags)
     OR aj.summary IN ('suspicious_activity', 'brute_force', 'rate_limit_violation'))
    AND (p_resolved IS NULL OR (p_resolved = true AND ser.resolved_at IS NOT NULL) OR (p_resolved = false AND ser.resolved_at IS NULL))
    AND (p_severity IS NULL OR aj.details->>'severity' = p_severity)
  ORDER BY aj.created_at DESC
  LIMIT p_limit;
END;
$function$;

-- Permissions
REVOKE ALL ON FUNCTION public.get_suspicious_patterns(boolean, text, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_suspicious_patterns(boolean, text, integer) TO authenticated;
