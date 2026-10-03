-- Function: public.create_user_reminder
-- Purpose: Generic create for a reminder DEFINITION (the schedule that drives
--          tracked actions). Fills a real gap — there was no generic reminder
--          CRUD, only create_story_reminder_audited for an unrelated CRM table.
--          Named user_reminder, not tracked_action: a reminder is the recurring
--          DEFINITION, distinct from the ACTION/event it later produces.
-- Access: authenticated member only (auth.uid()); SECURITY DEFINER + audit.

CREATE OR REPLACE FUNCTION public.create_user_reminder(p_title text, p_reminder_type text, p_frequency text, p_time_of_day time without time zone, p_description text DEFAULT NULL::text, p_questionnaire_id uuid DEFAULT NULL::uuid, p_product_id uuid DEFAULT NULL::uuid, p_study_registration_id uuid DEFAULT NULL::uuid, p_custom_frequency_days integer[] DEFAULT NULL::integer[], p_days_of_week integer[] DEFAULT NULL::integer[], p_quick_question text DEFAULT NULL::text, p_quick_response_type text DEFAULT NULL::text, p_points_per_completion integer DEFAULT 10, p_start_date date DEFAULT NULL::date, p_end_date date DEFAULT NULL::date, p_user_timezone text DEFAULT 'Europe/Prague'::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_user_id uuid := auth.uid();
  v_id uuid;
  v_targets integer;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;

  PERFORM enforce_rate_limit('create_user_reminder', 60000, 30);

  IF p_title IS NULL OR btrim(p_title) = '' THEN
    RAISE EXCEPTION 'title is required';
  END IF;
  IF p_reminder_type IS NULL OR btrim(p_reminder_type) = '' THEN
    RAISE EXCEPTION 'reminder_type is required';
  END IF;
  IF p_time_of_day IS NULL THEN
    RAISE EXCEPTION 'time_of_day is required';
  END IF;
  IF p_frequency IS NULL OR p_frequency NOT IN ('daily', 'weekly', 'biweekly', 'monthly', 'custom') THEN
    RAISE EXCEPTION 'invalid frequency: %', COALESCE(p_frequency, '(null)');
  END IF;
  IF p_frequency = 'custom' AND (p_custom_frequency_days IS NULL OR array_length(p_custom_frequency_days, 1) IS NULL) THEN
    RAISE EXCEPTION 'custom frequency requires custom_frequency_days';
  END IF;

  -- A reminder targets at most one of questionnaire / product / study.
  v_targets := (CASE WHEN p_questionnaire_id IS NOT NULL THEN 1 ELSE 0 END)
             + (CASE WHEN p_product_id IS NOT NULL THEN 1 ELSE 0 END)
             + (CASE WHEN p_study_registration_id IS NOT NULL THEN 1 ELSE 0 END);
  IF v_targets > 1 THEN
    RAISE EXCEPTION 'a reminder may target at most one of questionnaire/product/study';
  END IF;

  INSERT INTO user_reminders (
    user_id, title, description, reminder_type, questionnaire_id, product_id,
    study_registration_id, frequency, custom_frequency_days, time_of_day,
    days_of_week, quick_question, quick_response_type, points_per_completion,
    is_active, start_date, end_date, user_timezone
  ) VALUES (
    v_user_id, btrim(p_title), p_description, btrim(p_reminder_type), p_questionnaire_id, p_product_id,
    p_study_registration_id, p_frequency, p_custom_frequency_days, p_time_of_day,
    p_days_of_week, p_quick_question, p_quick_response_type, COALESCE(p_points_per_completion, 10),
    true, COALESCE(p_start_date, CURRENT_DATE), p_end_date, COALESCE(p_user_timezone, 'Europe/Prague')
  )
  RETURNING id INTO v_id;

  PERFORM public.write_audit_journal(
      p_action_type := 'create'::journal_action_type,
      p_area := 'member'::journal_area,
      p_details := jsonb_build_object('reminder_type', btrim(p_reminder_type), 'frequency', p_frequency),
      p_entity_id := v_id::text,
      p_entity_type := 'user_reminders',
      p_new_values := NULL,
      p_old_values := NULL,
      p_severity := 'notice'::journal_severity,
      p_summary := 'Member created a reminder',
      p_tags := ARRAY['member', 'reminder'],
      p_user_id := v_user_id
  );

  RETURN v_id;
END;
$function$;

REVOKE ALL ON FUNCTION public.create_user_reminder(text, text, text, time without time zone, text, uuid, uuid, uuid, integer[], integer[], text, text, integer, date, date, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.create_user_reminder(text, text, text, time without time zone, text, uuid, uuid, uuid, integer[], integer[], text, text, integer, date, date, text) TO authenticated;
