-- Function: public.create_story_reminder_audited
-- Arguments: p_story_id uuid, p_remind_at timestamp with time zone, p_message text
-- Security: See function definition below.
-- Extracted: 2026-01-08T18:26:13+01:00

CREATE OR REPLACE FUNCTION public.create_story_reminder_audited(p_story_id uuid, p_remind_at timestamp with time zone, p_message text DEFAULT NULL::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_user_id UUID;
  v_partner_id UUID;
  v_story_partner_id UUID;
  v_story_user_id UUID;
  v_owner_mode TEXT;
  v_audit_area public.journal_area;
  v_reminder_id UUID;
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  v_partner_id := public.get_current_partner_id();

  SELECT ps.partner_id, ps.user_id
  INTO v_story_partner_id, v_story_user_id
  FROM public.partner_stories ps
  WHERE ps.id = p_story_id;

  IF v_story_partner_id IS NULL THEN
    RAISE EXCEPTION 'Story not found';
  END IF;

  IF v_partner_id IS NOT NULL AND v_story_partner_id = v_partner_id THEN
    v_owner_mode := 'partner';
  ELSIF v_story_user_id = v_user_id THEN
    v_owner_mode := 'member';
  ELSE
    RAISE EXCEPTION 'Story not found or unauthorized';
  END IF;

  v_audit_area := CASE
    WHEN v_owner_mode = 'partner' THEN 'partner'::public.journal_area
    ELSE 'member'::public.journal_area
  END;

  INSERT INTO public.story_reminders (
    story_id, partner_id, remind_at, message
  ) VALUES (
    p_story_id, v_story_partner_id, p_remind_at, p_message
  )
  RETURNING id INTO v_reminder_id;

  -- Audit
  PERFORM public.write_audit_journal(
      p_action_type := 'create'::public.journal_action_type,
      p_area := v_audit_area,
      p_details := jsonb_build_object(
        'owner_mode', v_owner_mode,
        'story_id', p_story_id,
        'remind_at', p_remind_at
      ),
      p_entity_id := v_reminder_id::text,
      p_entity_type := 'story_reminders',
      p_severity := 'info'::public.journal_severity,
      p_summary := CASE
        WHEN v_owner_mode = 'partner' THEN 'Partner created story reminder'
        ELSE 'Member created story reminder'
      END,
    p_user_id := v_user_id
  );

  RETURN v_reminder_id;
END;
$function$
;

-- Permissions
REVOKE ALL ON FUNCTION public.create_story_reminder_audited(p_story_id uuid, p_remind_at timestamp with time zone, p_message text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.create_story_reminder_audited(p_story_id uuid, p_remind_at timestamp with time zone, p_message text) FROM anon;
GRANT EXECUTE ON FUNCTION public.create_story_reminder_audited(p_story_id uuid, p_remind_at timestamp with time zone, p_message text) TO authenticated;
