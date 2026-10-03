-- Function: public.delete_notification_campaign_schedule_admin
-- Description: Delete campaign schedule (admin/staff only).
-- Security: SECURITY DEFINER with search_path set.

CREATE OR REPLACE FUNCTION public.delete_notification_campaign_schedule_admin(
  p_id uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_campaign_id uuid;
BEGIN
  IF NOT public.is_admin_or_staff() THEN
    RAISE EXCEPTION 'Access denied';
  END IF;

  SELECT campaign_id INTO v_campaign_id
  FROM public.notification_campaign_schedules
  WHERE id = p_id;

  DELETE FROM public.notification_campaign_schedules
  WHERE id = p_id;

  PERFORM public.write_audit_journal(
      p_action_type := 'delete'::public.journal_action_type,
      p_area := 'notifications'::public.journal_area,
      p_details := NULL,
      p_entity_id := p_id::text,
      p_entity_type := 'notification_campaign_schedule',
      p_new_values := jsonb_build_object('campaign_id', v_campaign_id),
      p_old_values := NULL,
      p_severity := 'warning'::public.journal_severity,
      p_summary := 'Deleted notification campaign schedule',
      p_tags := ARRAY['admin', 'notifications', 'schedule', 'delete'],
      p_user_id := auth.uid()
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.delete_notification_campaign_schedule_admin(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.delete_notification_campaign_schedule_admin(uuid) TO authenticated;
