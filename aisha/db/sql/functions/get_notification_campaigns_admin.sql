-- Function: public.get_notification_campaigns_admin
-- Description: List notification campaigns with schedule counts (admin/staff only).
-- Security: SECURITY DEFINER with search_path set.

CREATE OR REPLACE FUNCTION public.get_notification_campaigns_admin()
RETURNS TABLE (
  id uuid,
  name text,
  description text,
  title_key text,
  body_key text,
  base_locale text,
  link text,
  data jsonb,
  audience_type text,
  audience_filter jsonb,
  send_push boolean,
  send_inapp boolean,
  is_active boolean,
  created_at timestamptz,
  updated_at timestamptz,
  schedule_count integer
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
      p_entity_id := NULL,
      p_entity_type := 'notification_campaign',
      p_new_values := NULL,
      p_old_values := NULL,
      p_severity := 'notice'::public.journal_severity,
      p_summary := 'Admin read notification campaign',
      p_tags := ARRAY['admin', 'notification_campaign'],
      p_user_id := auth.uid()
  );

  RETURN QUERY
  SELECT
    c.id,
    c.name,
    c.description,
    c.title_key,
    c.body_key,
    c.base_locale,
    c.link,
    c.data,
    c.audience_type,
    c.audience_filter,
    c.send_push,
    c.send_inapp,
    c.is_active,
    c.created_at,
    c.updated_at,
    (
      SELECT count(*)
      FROM public.notification_campaign_schedules s
      WHERE s.campaign_id = c.id
    ) AS schedule_count
  FROM public.notification_campaigns c
  ORDER BY c.updated_at DESC;
END;
$function$;

REVOKE ALL ON FUNCTION public.get_notification_campaigns_admin() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_notification_campaigns_admin() TO authenticated;
