-- Function: public.deactivate_user_reminder
-- Purpose: Soft-retire a reminder DEFINITION (is_active = false), preserving its
--          history (completions, tracked actions). Ownership-scoped to the caller.
-- Access: authenticated member only (auth.uid()); SECURITY DEFINER + audit.

CREATE OR REPLACE FUNCTION public.deactivate_user_reminder(p_reminder_id uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_user_id uuid := auth.uid();
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;

  PERFORM enforce_rate_limit('deactivate_user_reminder', 60000, 30);

  UPDATE user_reminders SET
    is_active = false,
    updated_at = now()
  WHERE id = p_reminder_id AND user_id = v_user_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Reminder not found or access denied';
  END IF;

  PERFORM public.write_audit_journal(
      p_action_type := 'update'::journal_action_type,
      p_area := 'member'::journal_area,
      p_details := jsonb_build_object('reminder_id', p_reminder_id, 'is_active', false),
      p_entity_id := p_reminder_id::text,
      p_entity_type := 'user_reminders',
      p_new_values := NULL,
      p_old_values := NULL,
      p_severity := 'notice'::journal_severity,
      p_summary := 'Member deactivated a reminder',
      p_tags := ARRAY['member', 'reminder'],
      p_user_id := v_user_id
  );

  RETURN true;
END;
$function$;

REVOKE ALL ON FUNCTION public.deactivate_user_reminder(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.deactivate_user_reminder(uuid) TO authenticated;
