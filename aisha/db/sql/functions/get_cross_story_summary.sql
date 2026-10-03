/**
 * get_cross_story_summary
 *
 * Returns a summary of a target story accessible via an accepted cross-story link.
 * Includes story metadata, recent entries (status updates, blockers, architecture
 * decisions, milestones), and link info. Access is validated via can_access_linked_story.
 * Logs the read to audit_journal.
 *
 * @param p_requesting_story_id - UUID of the story requesting the summary
 * @param p_target_story_id - UUID of the target story to summarize
 * @returns jsonb - Summary object with story details, recent entries, and link info
 */
CREATE OR REPLACE FUNCTION public.get_cross_story_summary(
  p_requesting_story_id uuid,
  p_target_story_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_user_id uuid := auth.uid();
  v_result jsonb;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Unauthorized: not authenticated';
  END IF;

  IF NOT public.can_access_linked_story(v_user_id, p_requesting_story_id, p_target_story_id) THEN
    RAISE EXCEPTION 'Unauthorized: no cross-story access';
  END IF;

  SELECT jsonb_build_object(
    'story_id', ps.id,
    'title', ps.title,
    'delivery_status', ps.delivery_status,
    'tech_stack', ps.tech_stack,
    'domain', ps.domain,
    'participant_count', (
      SELECT count(*)::int
      FROM public.story_participants sp
      WHERE sp.story_id = ps.id
    ),
    'recent_entries', (
      SELECT COALESCE(jsonb_agg(jsonb_build_object(
        'entry_type', se.entry_type,
        'summary', LEFT(se.content, 200),
        'created_at', se.created_at
      ) ORDER BY se.created_at DESC), '[]'::jsonb)
      FROM (
        SELECT entry_type, content, created_at
        FROM public.story_entries
        WHERE story_id = ps.id
          AND entry_type IN ('status_update', 'blocker', 'architecture_decision', 'milestone')
        ORDER BY created_at DESC
        LIMIT 5
      ) se
    ),
    'link_info', (
      SELECT jsonb_build_object(
        'link_type', sl.link_type,
        'link_direction', sl.link_direction,
        'created_at', sl.created_at,
        'confidence_score', sl.confidence_score
      )
      FROM public.story_links sl
      WHERE (
        (sl.source_story_id = p_requesting_story_id AND sl.target_story_id = p_target_story_id)
        OR (sl.source_story_id = p_target_story_id AND sl.target_story_id = p_requesting_story_id)
      )
      AND sl.is_accepted = true
      LIMIT 1
    )
  )
  INTO v_result
  FROM public.partner_stories ps
  WHERE ps.id = p_target_story_id;

  IF v_result IS NULL THEN
    RAISE EXCEPTION 'Target story not found: %', p_target_story_id;
  END IF;

  INSERT INTO public.audit_journal (user_id, action, metadata)
  VALUES (
    v_user_id,
    'CROSS_STORY_SUMMARY_READ',
    jsonb_build_object(
      'area', 'collaboration',
      'severity', 'info',
      'requesting_story_id', p_requesting_story_id,
      'target_story_id', p_target_story_id
    )
  );

  RETURN v_result;
END;
$function$;

REVOKE ALL ON FUNCTION public.get_cross_story_summary(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_cross_story_summary(uuid, uuid) TO authenticated;
