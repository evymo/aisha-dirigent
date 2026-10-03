-- Function: public.update_user_reminder
-- Purpose: Generic update for a reminder DEFINITION. Every field is optional;
--          NULL means "leave unchanged" (COALESCE). Ownership-scoped to the
--          caller. Use deactivate_user_reminder to retire a reminder.
-- Access: authenticated member only (auth.uid()); SECURITY DEFINER + audit.

CREATE OR REPLACE FUNCTION public.update_user_reminder(p_reminder_id uuid, p_title text DEFAULT NULL::text, p_description text DEFAULT NULL::text, p_frequency text DEFAULT NULL::text, p_time_of_day time without time zone DEFAULT NULL::time without time zone, p_custom_frequency_days integer[] DEFAULT NULL::integer[], p_days_of_week integer[] DEFAULT NULL::integer[], p_quick_question text DEFAULT NULL::text, p_quick_response_type text DEFAULT NULL::text, p_points_per_completion integer DEFAULT NULL::integer, p_end_date date DEFAULT NULL::date, p_user_timezone text DEFAULT NULL::text, p_is_active boolean DEFAULT NULL::boolean)
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

  PERFORM enforce_rate_limit('update_user_reminder', 60000, 30);

  IF p_frequency IS NOT NULL AND p_frequency NOT IN ('daily', 'weekly', 'biweekly', 'monthly', 'custom') THEN
    RAISE EXCEPTION 'invalid frequency: %', p_frequency;
  END IF;

  UPDATE user_reminders SET
    title = COALESCE(p_title, title),
    description = COALESCE(p_description, description),
    frequency = COALESCE(p_frequency, frequency),
    time_of_day = COALESCE(p_time_of_day, time_of_day),
    custom_frequency_days = COALESCE(p_custom_frequency_days, custom_frequency_days),
    days_of_week = COALESCE(p_days_of_week, days_of_week),
    quick_question = COALESCE(p_quick_question, quick_question),
    quick_response_type = COALESCE(p_quick_response_type, quick_response_type),
    points_per_completion = COALESCE(p_points_per_completion, points_per_completion),
    end_date = COALESCE(p_end_date, end_date),
    user_timezone = COALESCE(p_user_timezone, user_timezone),
    is_active = COALESCE(p_is_active, is_active),
    updated_at = now()
  WHERE id = p_reminder_id AND user_id = v_user_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Reminder not found or access denied';
  END IF;

  PERFORM public.write_audit_journal(
      p_action_type := 'update'::journal_action_type,
      p_area := 'member'::journal_area,
      p_details := jsonb_build_object('reminder_id', p_reminder_id),
      p_entity_id := p_reminder_id::text,
      p_entity_type := 'user_reminders',
      p_new_values := NULL,
      p_old_values := NULL,
      p_severity := 'notice'::journal_severity,
      p_summary := 'Member updated a reminder',
      p_tags := ARRAY['member', 'reminder'],
      p_user_id := v_user_id
  );

  RETURN true;
END;
$function$;

REVOKE ALL ON FUNCTION public.update_user_reminder(uuid, text, text, text, time without time zone, integer[], integer[], text, text, integer, date, text, boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.update_user_reminder(uuid, text, text, text, time without time zone, integer[], integer[], text, text, integer, date, text, boolean) TO authenticated;
