-- Function: public.delete_notification_campaign_admin
-- Description: Delete a notification campaign (admin/staff only).
-- Security: SECURITY DEFINER with search_path set.

CREATE OR REPLACE FUNCTION public.delete_notification_campaign_admin(
  p_id uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  IF NOT public.is_admin_or_staff() THEN
    RAISE EXCEPTION 'Access denied';
  END IF;

  DELETE FROM public.notification_campaigns
  WHERE id = p_id;

  PERFORM public.write_audit_journal(
      p_action_type := 'delete'::public.journal_action_type,
      p_area := 'notifications'::public.journal_area,
      p_details := NULL,
      p_entity_id := p_id::text,
      p_entity_type := 'notification_campaign',
      p_new_values := jsonb_build_object('campaign_id', p_id),
      p_old_values := NULL,
      p_severity := 'warning'::public.journal_severity,
      p_summary := 'Deleted notification campaign',
      p_tags := ARRAY['admin', 'notifications', 'campaign', 'delete'],
      p_user_id := auth.uid()
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.delete_notification_campaign_admin(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.delete_notification_campaign_admin(uuid) TO authenticated;
