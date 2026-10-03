/**
 * create_story_link
 *
 * Creates a link between two partner stories in the collaboration graph.
 * Validates user authorization, link_type, and story existence.
 * Logs the action to audit_journal.
 *
 * @param p_link_type - Type of link: depends_on, related_to, blocks, extends, shares_context
 * @param p_metadata - Optional JSONB metadata for the link
 * @param p_source_story_id - UUID of the source story
 * @param p_target_story_id - UUID of the target story
 * @returns jsonb - Created link details including id, story IDs, link_type
 */
CREATE OR REPLACE FUNCTION public.create_story_link(
  p_link_type text,
  p_metadata jsonb DEFAULT '{}'::jsonb,
  p_source_story_id uuid DEFAULT NULL,
  p_target_story_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_user_id uuid := auth.uid();
  v_link_id uuid;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Unauthorized: not authenticated' USING ERRCODE = '22023';
  END IF;

  IF NOT public.is_story_participant(v_user_id, p_source_story_id) AND NOT public.is_admin_or_staff(v_user_id) THEN
    RAISE EXCEPTION 'Unauthorized: not a participant of source story' USING ERRCODE = '22023';
  END IF;

  IF p_link_type NOT IN ('depends_on', 'related_to', 'blocks', 'extends', 'shares_context') THEN
    RAISE EXCEPTION 'Invalid link_type: %', p_link_type USING ERRCODE = '22023';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.partner_stories WHERE id = p_source_story_id) THEN
    RAISE EXCEPTION 'Source story not found: %', p_source_story_id USING ERRCODE = '22023';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.partner_stories WHERE id = p_target_story_id) THEN
    RAISE EXCEPTION 'Target story not found: %', p_target_story_id USING ERRCODE = '22023';
  END IF;

  IF p_source_story_id = p_target_story_id THEN
    RAISE EXCEPTION 'Cannot link a story to itself' USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.story_links (source_story_id, target_story_id, link_type, created_by, metadata)
  VALUES (p_source_story_id, p_target_story_id, p_link_type, v_user_id, p_metadata)
  ON CONFLICT (source_story_id, target_story_id, link_type) DO NOTHING
  RETURNING id INTO v_link_id;

  IF v_link_id IS NULL THEN
    RAISE EXCEPTION 'Link already exists between these stories with type: %', p_link_type USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.audit_journal (user_id, action, metadata)
  VALUES (
    v_user_id,
    'STORY_LINK_CREATED',
    jsonb_build_object(
      'area', 'collaboration',
      'severity', 'info',
      'link_id', v_link_id,
      'source_story_id', p_source_story_id,
      'target_story_id', p_target_story_id,
      'link_type', p_link_type
    )
  );

  RETURN jsonb_build_object(
    'id', v_link_id,
    'source_story_id', p_source_story_id,
    'target_story_id', p_target_story_id,
    'link_type', p_link_type,
    'is_accepted', NULL::boolean,
    'created', true
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.create_story_link(text, jsonb, uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.create_story_link(text, jsonb, uuid, uuid) TO authenticated;
