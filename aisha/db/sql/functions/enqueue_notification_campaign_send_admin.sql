-- Function: public.enqueue_notification_campaign_send_admin
-- Description: Enqueue an immediate send for a campaign (admin/staff only).
-- Security: SECURITY DEFINER with search_path set.

CREATE OR REPLACE FUNCTION public.enqueue_notification_campaign_send_admin(
  p_campaign_id uuid
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_schedule_id uuid;
BEGIN
  IF NOT public.is_admin_or_staff() THEN
    RAISE EXCEPTION 'Access denied';
  END IF;

  INSERT INTO public.notification_campaign_schedules (
    campaign_id,
    run_at,
    next_run_at,
    repeat_interval_minutes,
    status,
    created_by
  )
  VALUES (
    p_campaign_id,
    now(),
    now(),
    NULL,
    'scheduled',
    auth.uid()
  )
  RETURNING id INTO v_schedule_id;

  PERFORM public.write_audit_journal(
      p_action_type := 'create'::public.journal_action_type,
      p_area := 'notifications'::public.journal_area,
      p_details := NULL,
      p_entity_id := v_schedule_id::text,
      p_entity_type := 'notification_campaign_schedule',
      p_new_values := jsonb_build_object('campaign_id', p_campaign_id),
      p_old_values := NULL,
      p_severity := 'info'::public.journal_severity,
      p_summary := 'Enqueued immediate notification campaign send',
      p_tags := ARRAY['admin', 'notifications', 'schedule', 'enqueue'],
      p_user_id := auth.uid()
  );

  RETURN v_schedule_id;
END;
$function$;

REVOKE ALL ON FUNCTION public.enqueue_notification_campaign_send_admin(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.enqueue_notification_campaign_send_admin(uuid) TO authenticated;
