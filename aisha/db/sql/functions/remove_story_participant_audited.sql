-- Function: public.remove_story_participant_audited
-- Arguments: p_story_id uuid, p_target_user_id uuid
-- Description: Remove a participant from a story. Supports self-removal. Last owner cannot be removed.
-- Security: SECURITY DEFINER, authenticated only (owner, admin/staff, or self)
-- Source: Migration 20260329230000_story_participants_foundation.sql

CREATE OR REPLACE FUNCTION public.remove_story_participant_audited(
  p_story_id uuid,
  p_target_user_id uuid
)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_user_id uuid := auth.uid();
  v_is_self_removal boolean;
  v_target_role text;
  v_partner_count integer;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  v_is_self_removal := (v_user_id = p_target_user_id);

  -- Get target's role
  SELECT sp.role INTO v_target_role
  FROM public.story_participants sp
  WHERE sp.story_id = p_story_id AND sp.user_id = p_target_user_id;

  IF v_target_role IS NULL THEN
    RAISE EXCEPTION 'User is not a participant of this story';
  END IF;

  -- Authorization: self-removal is always allowed, otherwise need partner role or admin/staff
  IF NOT v_is_self_removal THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.story_participants sp
      WHERE sp.story_id = p_story_id AND sp.user_id = v_user_id AND sp.role = 'partner'
    ) AND NOT is_admin_or_staff() THEN
      RAISE EXCEPTION 'Unauthorized: Only story owner can remove participants';
    END IF;
  END IF;

  -- Prevent last partner removal
  IF v_target_role = 'partner' THEN
    SELECT COUNT(*) INTO v_partner_count
    FROM public.story_participants sp
    WHERE sp.story_id = p_story_id AND sp.role = 'partner';

    IF v_partner_count <= 1 THEN
      RAISE EXCEPTION 'Cannot remove the last owner of a story' USING ERRCODE = 'P0001';
    END IF;
  END IF;

  -- Delete participant
  DELETE FROM public.story_participants
  WHERE story_id = p_story_id AND user_id = p_target_user_id;

  -- Audit
  PERFORM public.write_audit_journal(
    p_action_type := 'delete'::public.journal_action_type,
    p_area := 'partner'::public.journal_area,
    p_details := jsonb_build_object(
      'story_id', p_story_id,
      'target_user_id', p_target_user_id,
      'self_removal', v_is_self_removal,
      'removed_role', v_target_role
    ),
    p_entity_id := p_story_id::text,
    p_entity_type := 'story_participants',
    p_severity := 'notice'::public.journal_severity,
    p_summary := CASE
      WHEN v_is_self_removal THEN 'User left story'
      ELSE 'Removed participant from story'
    END,
    p_user_id := v_user_id
  );

  RETURN jsonb_build_object(
    'success', true,
    'story_id', p_story_id,
    'removed_user_id', p_target_user_id,
    'self_removal', v_is_self_removal
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.remove_story_participant_audited(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.remove_story_participant_audited(uuid, uuid) TO authenticated;
