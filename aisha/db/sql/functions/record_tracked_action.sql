-- Function: public.record_tracked_action
-- Purpose: Universal WRITE verb for the tracked_action surface — record that the
--          member did / reacted to something, in the same generic vocabulary the
--          read model (get_my_tracked_actions) exposes. Lands in the additive
--          tracked_actions table. Rich domain events (a dose, a check-in, a
--          reminder completion) keep their specialized writers
--          (create_dosing_log_audited / create_health_check_in /
--          complete_reminder) — this is only for actions with no thematic home.
-- Access: authenticated member only (auth.uid()); SECURITY DEFINER + audit.

CREATE OR REPLACE FUNCTION public.record_tracked_action(p_action_type text, p_payload jsonb DEFAULT '{}'::jsonb, p_reminder_id uuid DEFAULT NULL::uuid, p_occurred_at timestamptz DEFAULT NULL::timestamptz)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_user_id uuid := auth.uid();
  v_id uuid;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;

  IF p_action_type IS NULL OR btrim(p_action_type) = '' THEN
    RAISE EXCEPTION 'action_type is required';
  END IF;

  PERFORM enforce_rate_limit('record_tracked_action', 60000, 60);

  -- A referenced reminder must belong to the caller.
  IF p_reminder_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM user_reminders WHERE id = p_reminder_id AND user_id = v_user_id
  ) THEN
    RAISE EXCEPTION 'Reminder not found or access denied';
  END IF;

  INSERT INTO tracked_actions (user_id, action_type, occurred_at, reminder_id, payload)
  VALUES (
    v_user_id,
    btrim(p_action_type),
    COALESCE(p_occurred_at, now()),
    p_reminder_id,
    COALESCE(p_payload, '{}'::jsonb)
  )
  RETURNING id INTO v_id;

  PERFORM public.write_audit_journal(
      p_action_type := 'create'::journal_action_type,
      p_area := 'member'::journal_area,
      p_details := jsonb_build_object('action_type', btrim(p_action_type), 'reminder_id', p_reminder_id),
      p_entity_id := v_id::text,
      p_entity_type := 'tracked_actions',
      p_new_values := NULL,
      p_old_values := NULL,
      p_severity := 'notice'::journal_severity,
      p_summary := 'Member recorded a tracked action',
      p_tags := ARRAY['member', 'tracked_action'],
      p_user_id := v_user_id
  );

  RETURN v_id;
END;
$function$;

REVOKE ALL ON FUNCTION public.record_tracked_action(text, jsonb, uuid, timestamptz) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.record_tracked_action(text, jsonb, uuid, timestamptz) TO authenticated;
