/**
 * dismiss_story_link
 *
 * Dismisses (rejects) a story link. Participants of either the source
 * or target story, or admin/staff, can dismiss. Logs to audit_journal.
 *
 * @param p_link_id - UUID of the story link to dismiss
 * @returns jsonb - Result with link id, acceptance status (false), and update flag
 */
CREATE OR REPLACE FUNCTION public.dismiss_story_link(
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

  IF NOT public.is_story_participant(v_user_id, v_link.source_story_id)
    AND NOT public.is_story_participant(v_user_id, v_link.target_story_id)
    AND NOT public.is_admin_or_staff(v_user_id) THEN
    RAISE EXCEPTION 'Unauthorized: not a participant of linked stories';
  END IF;

  UPDATE public.story_links
  SET is_accepted = false
  WHERE id = p_link_id;

  GET DIAGNOSTICS v_rows_updated = ROW_COUNT;

  INSERT INTO public.audit_journal (user_id, action, metadata)
  VALUES (
    v_user_id,
    'STORY_LINK_DISMISSED',
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
    'is_accepted', false,
    'updated', v_rows_updated > 0
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.dismiss_story_link(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.dismiss_story_link(uuid) TO authenticated;
