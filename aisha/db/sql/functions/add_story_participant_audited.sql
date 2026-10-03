-- Function: public.add_story_participant_audited
-- Arguments: p_story_id uuid, p_target_user_id uuid, p_role text DEFAULT 'guild_expert'
-- Description: Add a certified partner as participant to a story.
-- Security: SECURITY DEFINER, authenticated only (owner or admin/staff)
-- Source: Migration 20260329230000_story_participants_foundation.sql

CREATE OR REPLACE FUNCTION public.add_story_participant_audited(
  p_story_id uuid,
  p_target_user_id uuid,
  p_role text DEFAULT 'guild_expert'
)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_user_id uuid := auth.uid();
  v_story_title text;
  v_target_name text;
  v_caller_name text;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  -- Validate role
  IF p_role NOT IN ('guild_expert', 'partner') THEN
    RAISE EXCEPTION USING MESSAGE = format('Invalid participant role: %s', p_role), ERRCODE = '22023';
  END IF;

  -- Authorization: caller must be partner-role participant or admin/staff
  IF NOT EXISTS (
    SELECT 1 FROM public.story_participants sp
    WHERE sp.story_id = p_story_id AND sp.user_id = v_user_id AND sp.role = 'partner'
  ) AND NOT is_admin_or_staff() THEN
    RAISE EXCEPTION 'Unauthorized: Only story owner can add participants';
  END IF;

  -- Validate target is certified partner
  IF NOT EXISTS (
    SELECT 1 FROM public.partner_profiles pp
    WHERE pp.user_id = p_target_user_id
      AND pp.certification_passed_at IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'Target user is not a certified partner';
  END IF;

  -- Check not already participant
  IF EXISTS (
    SELECT 1 FROM public.story_participants sp
    WHERE sp.story_id = p_story_id AND sp.user_id = p_target_user_id
  ) THEN
    RAISE EXCEPTION 'User is already a participant of this story';
  END IF;

  -- Get story title for notification
  SELECT ps.title INTO v_story_title
  FROM public.partner_stories ps
  WHERE ps.id = p_story_id;

  IF v_story_title IS NULL THEN
    RAISE EXCEPTION 'Story not found';
  END IF;

  -- Get display names for notification
  SELECT COALESCE(p.first_name || ' ' || LEFT(p.last_name, 1) || '.', 'Unknown')
  INTO v_caller_name
  FROM public.profiles p WHERE p.id = v_user_id;

  SELECT COALESCE(p.first_name || ' ' || LEFT(p.last_name, 1) || '.', 'Unknown')
  INTO v_target_name
  FROM public.profiles p WHERE p.id = p_target_user_id;

  -- Insert participant
  INSERT INTO public.story_participants (story_id, user_id, role)
  VALUES (p_story_id, p_target_user_id, p_role);

  -- Create notification for target user
  INSERT INTO public.notifications (user_id, type, title, message, action_url, metadata)
  VALUES (
    p_target_user_id,
    'story_share',
    'Story collaboration invitation',
    v_caller_name || ' invited you to collaborate on: ' || v_story_title,
    '/partner/storyloop?story=' || p_story_id::text,
    jsonb_build_object(
      'source', 'aisha',
      'event_type', 'story_share',
      'story_id', p_story_id,
      'invited_by', v_user_id,
      'role', p_role
    )
  );

  -- Audit
  PERFORM public.write_audit_journal(
    p_action_type := 'create'::public.journal_action_type,
    p_area := 'partner'::public.journal_area,
    p_details := jsonb_build_object(
      'story_id', p_story_id,
      'target_user_id', p_target_user_id,
      'role', p_role
    ),
    p_entity_id := p_story_id::text,
    p_entity_type := 'story_participants',
    p_severity := 'notice'::public.journal_severity,
    p_summary := 'Added participant to story',
    p_user_id := v_user_id
  );

  RETURN jsonb_build_object(
    'success', true,
    'story_id', p_story_id,
    'target_user_id', p_target_user_id,
    'role', p_role
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.add_story_participant_audited(uuid, uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.add_story_participant_audited(uuid, uuid, text) TO authenticated;
