-- Function: public.get_notification_campaign_runs_admin
-- Description: List recent notification campaign runs (admin/staff only).
-- Security: SECURITY DEFINER with search_path set.

CREATE OR REPLACE FUNCTION public.get_notification_campaign_runs_admin(
  p_campaign_id uuid,
  p_limit integer DEFAULT 50
)
RETURNS TABLE (
  id uuid,
  campaign_id uuid,
  schedule_id uuid,
  run_at timestamptz,
  status text,
  recipients_count integer,
  push_sent integer,
  inapp_sent integer,
  errors jsonb
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
      p_entity_type := 'notification_campaign_run',
      p_new_values := jsonb_build_object('limit', p_limit),
      p_old_values := NULL,
      p_severity := 'notice'::public.journal_severity,
      p_summary := 'Admin read notification campaign run',
      p_tags := ARRAY['admin', 'notification_campaign_run'],
      p_user_id := auth.uid()
  );

  RETURN QUERY
  SELECT
    r.id,
    r.campaign_id,
    r.schedule_id,
    r.run_at,
    r.status,
    r.recipients_count,
    r.push_sent,
    r.inapp_sent,
    r.errors
  FROM public.notification_campaign_runs r
  WHERE r.campaign_id = p_campaign_id
  ORDER BY r.run_at DESC
  LIMIT GREATEST(COALESCE(p_limit, 50), 1);
END;
$function$;

REVOKE ALL ON FUNCTION public.get_notification_campaign_runs_admin(uuid, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_notification_campaign_runs_admin(uuid, integer) TO authenticated;
