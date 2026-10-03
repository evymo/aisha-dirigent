-- Function: public.get_notification_campaign_schedules_admin
-- Description: List schedules for a notification campaign (admin/staff only).
-- Security: SECURITY DEFINER with search_path set.

CREATE OR REPLACE FUNCTION public.get_notification_campaign_schedules_admin(
  p_campaign_id uuid
)
RETURNS TABLE (
  id uuid,
  campaign_id uuid,
  run_at timestamptz,
  next_run_at timestamptz,
  repeat_interval_minutes integer,
  status text,
  last_run_at timestamptz,
  created_at timestamptz,
  updated_at timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  IF NOT public.is_admin_or_staff() THEN
    RAISE EXCEPTION 'Access denied';
  END IF;


  -- Audit log
  PERFORM public.write_audit_journal(
      p_action_type := 'read'::public.journal_action_type,
      p_area := 'notifications'::public.journal_area,
      p_details := NULL,
      p_entity_id := p_campaign_id::text,
      p_entity_type := 'notification_campaign_schedule',
      p_new_values := NULL,
      p_old_values := NULL,
      p_severity := 'notice'::public.journal_severity,
      p_summary := 'Admin read notification campaign schedule',
      p_tags := ARRAY['admin', 'notification_campaign_schedule'],
      p_user_id := auth.uid()
  );

  RETURN QUERY
  SELECT
    s.id,
    s.campaign_id,
    s.run_at,
    s.next_run_at,
    s.repeat_interval_minutes,
    s.status,
    s.last_run_at,
    s.created_at,
    s.updated_at
  FROM public.notification_campaign_schedules s
  WHERE s.campaign_id = p_campaign_id
  ORDER BY s.next_run_at ASC;
END;
$function$;

REVOKE ALL ON FUNCTION public.get_notification_campaign_schedules_admin(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_notification_campaign_schedules_admin(uuid) TO authenticated;
