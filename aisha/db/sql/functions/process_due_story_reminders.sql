-- Function: process_due_story_reminders

CREATE OR REPLACE FUNCTION public.process_due_story_reminders()
 RETURNS TABLE(processed_count integer, processed_at timestamp with time zone)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_count integer := 0;
  v_reminder RECORD;
  v_notification_id uuid;
  v_link text;
BEGIN
  FOR v_reminder IN
    SELECT
      sr.id,
      sr.story_id,
      sr.partner_id,
      sr.message,
      sr.remind_at,
      ps.title AS story_title,
      ps.user_id AS story_user_id,
      pp.user_id AS partner_user_id
    FROM public.story_reminders sr
    JOIN public.partner_stories ps ON ps.id = sr.story_id
    JOIN public.partner_profiles pp ON pp.id = sr.partner_id
    WHERE sr.is_completed = false
      AND sr.remind_at <= now()
    ORDER BY sr.remind_at ASC
    FOR UPDATE OF sr SKIP LOCKED
  LOOP
    -- Build deep link to the story in partner workspace
    v_link := '/partner/storyloop?story=' || v_reminder.story_id::text;

    -- Create notification for the partner (who set the reminder)
    INSERT INTO public.notifications (user_id, type, title, message, link, metadata)
    VALUES (
      v_reminder.partner_user_id,
      'story_reminder',
      COALESCE(v_reminder.story_title, 'Story'),
      COALESCE(v_reminder.message, 'Naplánovaná připomínka'),
      v_link,
      jsonb_build_object(
        'reminder_id', v_reminder.id,
        'story_id', v_reminder.story_id,
        'remind_at', v_reminder.remind_at
      )
    )
    RETURNING id INTO v_notification_id;

    -- Mark reminder as completed
    UPDATE public.story_reminders
    SET is_completed = true, completed_at = now()
    WHERE id = v_reminder.id;

    -- Audit log (system action, no user context)
    PERFORM public.write_audit_journal(
      p_action_type := 'scheduled_task'::public.journal_action_type,
      p_area        := 'system'::public.journal_area,
      p_details     := jsonb_build_object(
        'reminder_id', v_reminder.id,
        'story_id', v_reminder.story_id,
        'notification_id', v_notification_id,
        'remind_at', v_reminder.remind_at,
        'partner_user_id', v_reminder.partner_user_id
      ),
      p_entity_id   := v_reminder.id::text,
      p_entity_type := 'story_reminders',
      p_severity    := 'info'::public.journal_severity,
      p_summary     := 'Processed due story reminder',
    p_user_id := auth.uid()
  );

    v_count := v_count + 1;
  END LOOP;

  RETURN QUERY SELECT v_count, now();
END;
$function$;

REVOKE ALL ON FUNCTION process_due_story_reminders() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION process_due_story_reminders() TO service_role;
