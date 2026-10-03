-- Function: public.get_distribution_calendar_admin
-- Arguments: p_from date, p_to date
-- Description: Get distribution calendar entries. Admin/staff only.
-- Security: SECURITY DEFINER, admin/staff only
-- Updated: 2026-01-09 - Added p_from and p_to date range params

CREATE OR REPLACE FUNCTION public.get_distribution_calendar_admin(
  p_from date DEFAULT NULL,
  p_to date DEFAULT NULL
)
RETURNS SETOF distribution_calendar
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  IF NOT public.is_admin_or_staff() THEN
    RAISE EXCEPTION 'Admin or staff access required';
  END IF;
  
  INSERT INTO audit_journal (
    user_id, action_type, entity_type, area, severity, summary
  ) VALUES (
    auth.uid(), 'read'::journal_action_type, 'distribution_calendar_admin', 
    'production'::journal_area, 'info'::journal_severity,
    'Admin viewed distribution calendar'
  );
  
  RETURN QUERY 
  SELECT dc.id, dc.scheduled_date, dc.scheduled_time, dc.status, dc.orders_count,
         dc.processed_count, dc.failed_count, dc.notes, dc.orders, dc.created_at,
         dc.processed_at
  FROM public.distribution_calendar dc
  WHERE (p_from IS NULL OR dc.scheduled_date >= p_from)
    AND (p_to IS NULL OR dc.scheduled_date <= p_to)
  ORDER BY dc.scheduled_date DESC;
END;
$function$;

-- Permissions
REVOKE ALL ON FUNCTION public.get_distribution_calendar_admin(date, date) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_distribution_calendar_admin(date, date) TO authenticated;
