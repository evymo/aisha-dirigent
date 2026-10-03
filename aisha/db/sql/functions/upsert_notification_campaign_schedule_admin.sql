-- Function: public.upsert_notification_campaign_schedule_admin
-- Description: Create or update campaign schedule (admin/staff only).
-- Security: SECURITY DEFINER with search_path set.

CREATE OR REPLACE FUNCTION public.upsert_notification_campaign_schedule_admin(
  p_campaign_id uuid,
  p_run_at timestamptz,
  p_id uuid DEFAULT NULL,
  p_repeat_interval_minutes integer DEFAULT NULL,
  p_status text DEFAULT 'scheduled'
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
#variable_conflict use_column
DECLARE
  v_id uuid;
  v_exists boolean;
  v_action public.journal_action_type;
BEGIN
  IF NOT public.is_admin_or_staff() THEN
    RAISE EXCEPTION 'Access denied';
  END IF;

  v_id := COALESCE(p_id, gen_random_uuid());

  SELECT EXISTS (
    SELECT 1 FROM public.notification_campaign_schedules WHERE id = v_id
  ) INTO v_exists;

  INSERT INTO public.notification_campaign_schedules (
    id,
    campaign_id,
    run_at,
    next_run_at,
    repeat_interval_minutes,
    status,
    created_by
  )
  VALUES (
    v_id,
    p_campaign_id,
    p_run_at,
    p_run_at,
    p_repeat_interval_minutes,
    COALESCE(p_status, 'scheduled'),
    auth.uid()
  )
  ON CONFLICT (id) DO UPDATE SET
    campaign_id = EXCLUDED.campaign_id,
    run_at = EXCLUDED.run_at,
    next_run_at = EXCLUDED.next_run_at,
    repeat_interval_minutes = EXCLUDED.repeat_interval_minutes,
    status = EXCLUDED.status,
    updated_at = now()
  RETURNING
    notification_campaign_schedules.id,
    notification_campaign_schedules.campaign_id,
    notification_campaign_schedules.run_at,
    notification_campaign_schedules.next_run_at,
    notification_campaign_schedules.repeat_interval_minutes,
    notification_campaign_schedules.status,
    notification_campaign_schedules.last_run_at,
    notification_campaign_schedules.created_at,
    notification_campaign_schedules.updated_at
  INTO
    id,
    campaign_id,
    run_at,
    next_run_at,
    repeat_interval_minutes,
    status,
    last_run_at,
    created_at,
    updated_at;

  v_action := CASE WHEN v_exists THEN 'update'::public.journal_action_type ELSE 'create'::public.journal_action_type END;

  PERFORM public.write_audit_journal(
      p_action_type := v_action,
      p_area := 'notifications'::public.journal_area,
      p_details := NULL,
      p_entity_id := v_id::text,
      p_entity_type := 'notification_campaign_schedule',
      p_new_values := jsonb_build_object('campaign_id', p_campaign_id, 'run_at', p_run_at),
      p_old_values := NULL,
      p_severity := 'info'::public.journal_severity,
      p_summary := CASE WHEN v_exists THEN 'Updated notification campaign schedule' ELSE 'Created notification campaign schedule' END,
      p_tags := ARRAY['admin', 'notifications', 'schedule'],
      p_user_id := auth.uid()
  );

  RETURN NEXT;
  RETURN;
END;
$function$;

REVOKE ALL ON FUNCTION public.upsert_notification_campaign_schedule_admin(
  uuid, timestamptz, uuid, integer, text
) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.upsert_notification_campaign_schedule_admin(
  uuid, timestamptz, uuid, integer, text
) TO authenticated;
