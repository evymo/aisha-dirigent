-- Function: public.upsert_notification_campaign_admin
-- Description: Create or update a notification campaign (admin/staff only).
-- Security: SECURITY DEFINER with search_path set.

CREATE OR REPLACE FUNCTION public.upsert_notification_campaign_admin(
  p_name text,
  p_id uuid DEFAULT NULL,
  p_description text DEFAULT NULL,
  p_title_key text DEFAULT NULL,
  p_body_key text DEFAULT NULL,
  p_base_locale text DEFAULT 'en',
  p_link text DEFAULT NULL,
  p_data jsonb DEFAULT NULL,
  p_audience_type text DEFAULT 'all',
  p_audience_filter jsonb DEFAULT NULL,
  p_send_push boolean DEFAULT true,
  p_send_inapp boolean DEFAULT true,
  p_is_active boolean DEFAULT true
)
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
  updated_at timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
#variable_conflict use_column
DECLARE
  v_id uuid;
  v_title_key text;
  v_body_key text;
  v_exists boolean;
  v_action public.journal_action_type;
BEGIN
  IF NOT public.is_admin_or_staff() THEN
    RAISE EXCEPTION 'Access denied';
  END IF;

  v_id := COALESCE(p_id, gen_random_uuid());
  v_title_key := COALESCE(p_title_key, 'notifications.campaign.' || v_id || '.title');
  v_body_key := COALESCE(p_body_key, 'notifications.campaign.' || v_id || '.body');

  SELECT EXISTS (
    SELECT 1 FROM public.notification_campaigns WHERE id = v_id
  ) INTO v_exists;

  INSERT INTO public.notification_campaigns (
    id,
    name,
    description,
    title_key,
    body_key,
    base_locale,
    link,
    data,
    audience_type,
    audience_filter,
    send_push,
    send_inapp,
    is_active,
    created_by,
    updated_by
  )
  VALUES (
    v_id,
    p_name,
    p_description,
    v_title_key,
    v_body_key,
    COALESCE(p_base_locale, 'en'),
    p_link,
    p_data,
    COALESCE(p_audience_type, 'all'),
    p_audience_filter,
    COALESCE(p_send_push, true),
    COALESCE(p_send_inapp, true),
    COALESCE(p_is_active, true),
    auth.uid(),
    auth.uid()
  )
  ON CONFLICT (id) DO UPDATE SET
    name = EXCLUDED.name,
    description = EXCLUDED.description,
    title_key = EXCLUDED.title_key,
    body_key = EXCLUDED.body_key,
    base_locale = EXCLUDED.base_locale,
    link = EXCLUDED.link,
    data = EXCLUDED.data,
    audience_type = EXCLUDED.audience_type,
    audience_filter = EXCLUDED.audience_filter,
    send_push = EXCLUDED.send_push,
    send_inapp = EXCLUDED.send_inapp,
    is_active = EXCLUDED.is_active,
    updated_by = EXCLUDED.updated_by,
    updated_at = now()
  RETURNING
    notification_campaigns.id,
    notification_campaigns.name,
    notification_campaigns.description,
    notification_campaigns.title_key,
    notification_campaigns.body_key,
    notification_campaigns.base_locale,
    notification_campaigns.link,
    notification_campaigns.data,
    notification_campaigns.audience_type,
    notification_campaigns.audience_filter,
    notification_campaigns.send_push,
    notification_campaigns.send_inapp,
    notification_campaigns.is_active,
    notification_campaigns.created_at,
    notification_campaigns.updated_at
  INTO
    id,
    name,
    description,
    title_key,
    body_key,
    base_locale,
    link,
    data,
    audience_type,
    audience_filter,
    send_push,
    send_inapp,
    is_active,
    created_at,
    updated_at;

  v_action := CASE WHEN v_exists THEN 'update'::public.journal_action_type ELSE 'create'::public.journal_action_type END;

  PERFORM public.write_audit_journal(
      p_action_type := v_action,
      p_area := 'notifications'::public.journal_area,
      p_details := NULL,
      p_entity_id := v_id::text,
      p_entity_type := 'notification_campaign',
      p_new_values := jsonb_build_object('name', p_name, 'audience_type', p_audience_type),
      p_old_values := NULL,
      p_severity := 'info'::public.journal_severity,
      p_summary := CASE WHEN v_exists THEN 'Updated notification campaign' ELSE 'Created notification campaign' END,
      p_tags := ARRAY['admin', 'notifications', 'campaign'],
      p_user_id := auth.uid()
  );

  RETURN NEXT;
  RETURN;
END;
$function$;

REVOKE ALL ON FUNCTION public.upsert_notification_campaign_admin(
  text, uuid, text, text, text, text, text, jsonb, text, jsonb, boolean, boolean, boolean
) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.upsert_notification_campaign_admin(
  text, uuid, text, text, text, text, text, jsonb, text, jsonb, boolean, boolean, boolean
) TO authenticated;
