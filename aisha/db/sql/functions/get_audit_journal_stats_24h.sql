-- Function: public.get_audit_journal_stats_24h
-- Arguments: (none)
-- Description: Get 24h audit journal statistics grouped by action, area, severity.
-- Security: SECURITY DEFINER, admin/staff only.
-- Updated: 2026-01-18 - Added severity column for complete stats

CREATE OR REPLACE FUNCTION public.get_audit_journal_stats_24h()
 RETURNS TABLE(action text, area text, severity text, count bigint)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NOT public.is_admin_or_staff() THEN
    RAISE EXCEPTION 'Access denied: admin or staff role required';
  END IF;

  RETURN QUERY
  SELECT 
    aj.action,
    aj.metadata->>'area' AS area,
    COALESCE(aj.metadata->>'severity', aj.severity, 'info')::text AS severity,
    count(*)::bigint
  FROM public.audit_journal aj
  WHERE aj.created_at >= now() - interval '24 hours'
  GROUP BY aj.action, aj.metadata->>'area', COALESCE(aj.metadata->>'severity', aj.severity, 'info')
  ORDER BY count(*) DESC;
END;
$function$
;

-- Permissions
REVOKE ALL ON FUNCTION public.get_audit_journal_stats_24h() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_audit_journal_stats_24h() TO authenticated;
