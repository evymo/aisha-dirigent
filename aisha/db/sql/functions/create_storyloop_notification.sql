-- Function: public.create_storyloop_notification
-- Arguments: p_user_id uuid, p_type text, p_title text, p_message text, p_link text
-- Security: See function definition below.
-- Extracted: 2026-01-08T18:26:13+01:00

CREATE OR REPLACE FUNCTION public.create_storyloop_notification(p_user_id uuid, p_type text, p_title text, p_message text, p_link text DEFAULT NULL::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_notification_id UUID;
  v_caller_partner_id UUID;
  v_user_id uuid := auth.uid();
  v_is_admin boolean := false;
  v_is_consultant boolean := false;
  v_has_consent boolean := false;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  -- Get caller's partner ID
  SELECT pp.id INTO v_caller_partner_id
  FROM partner_profiles pp
  WHERE pp.user_id = auth.uid();
  
  v_is_admin := is_admin_or_staff(v_user_id);
  v_is_consultant := public.is_consultant_for_user(p_user_id);
  v_has_consent := public.has_data_sharing_consent(p_user_id, v_user_id);
  
  -- Must be a partner or admin/staff
  IF v_caller_partner_id IS NULL AND NOT v_is_admin THEN
    RAISE EXCEPTION 'Not authorized to create notifications';
  END IF;

  -- If not admin/staff, require relationship or consent with the target member
  IF NOT v_is_admin AND NOT (v_is_consultant OR v_has_consent) THEN
    RAISE EXCEPTION 'Not authorized to notify this user';
  END IF;
  
  -- Create the notification
  INSERT INTO notifications (user_id, type, title, message, link)
  VALUES (p_user_id, p_type, p_title, p_message, p_link)
  RETURNING id INTO v_notification_id;

  INSERT INTO audit_journal (user_id, action_type, entity_type, entity_id, area, severity, summary, metadata)
  VALUES (
    v_user_id,
    'create',
    'notification',
    v_notification_id::text,
    'partner',
    'info',
    'Created StoryLoop notification',
    jsonb_build_object('target_user_id', p_user_id, 'type', p_type)
  );
  
  RETURN v_notification_id;
END;
$function$
;

-- Permissions
REVOKE ALL ON FUNCTION public.create_storyloop_notification(p_user_id uuid, p_type text, p_title text, p_message text, p_link text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.create_storyloop_notification(p_user_id uuid, p_type text, p_title text, p_message text, p_link text) TO authenticated;
