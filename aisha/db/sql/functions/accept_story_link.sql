/**
 * accept_story_link
 *
 * Accepts a pending story link. Only participants of the target story
 * or admin/staff can accept. Logs the action to audit_journal.
 *
 * @param p_link_id - UUID of the story link to accept
 * @returns jsonb - Result with link id, acceptance status, and update flag
 */
CREATE OR REPLACE FUNCTION public.accept_story_link(
  p_link_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_user_id uuid := auth.uid();
  v_link record;
  v_rows_updated int := 0;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Unauthorized: not authenticated';
  END IF;

  SELECT id, source_story_id, target_story_id, link_type, is_accepted
  INTO v_link
  FROM public.story_links
  WHERE id = p_link_id;

  IF v_link IS NULL THEN
    RAISE EXCEPTION 'Story link not found: %', p_link_id;
  END IF;

  IF v_link.is_accepted = true THEN
    RETURN jsonb_build_object('id', p_link_id, 'already_accepted', true);
  END IF;

  IF NOT public.is_story_participant(v_user_id, v_link.target_story_id) AND NOT public.is_admin_or_staff(v_user_id) THEN
    RAISE EXCEPTION 'Unauthorized: not a participant of target story';
  END IF;

  UPDATE public.story_links
  SET is_accepted = true
  WHERE id = p_link_id;

  GET DIAGNOSTICS v_rows_updated = ROW_COUNT;

  INSERT INTO public.audit_journal (user_id, action, metadata)
  VALUES (
    v_user_id,
    'STORY_LINK_ACCEPTED',
    jsonb_build_object(
      'area', 'collaboration',
      'severity', 'info',
      'link_id', p_link_id,
      'source_story_id', v_link.source_story_id,
      'target_story_id', v_link.target_story_id,
      'link_type', v_link.link_type
    )
  );

  RETURN jsonb_build_object(
    'id', p_link_id,
    'is_accepted', true,
    'updated', v_rows_updated > 0
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.accept_story_link(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.accept_story_link(uuid) TO authenticated;
