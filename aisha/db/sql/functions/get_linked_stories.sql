/**
 * get_linked_stories
 *
 * Returns all stories linked to a given story (both incoming and outgoing links).
 * Includes linked story metadata, participant counts, and link details.
 * User must be a participant or admin/staff.
 *
 * @param p_story_id - UUID of the story to get links for
 * @returns jsonb - Array of linked story objects with link metadata
 */
CREATE OR REPLACE FUNCTION public.get_linked_stories(
  p_story_id uuid
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

  IF NOT public.is_story_participant(v_user_id, p_story_id) AND NOT public.is_admin_or_staff(v_user_id) THEN
    RAISE EXCEPTION 'Unauthorized: not a participant of this story';
  END IF;

  SELECT COALESCE(jsonb_agg(row_to_json(t)::jsonb), '[]'::jsonb)
  INTO v_result
  FROM (
    SELECT
      sl.id AS link_id,
      sl.link_type,
      sl.link_direction,
      sl.is_accepted,
      sl.confidence_score,
      sl.created_by_agent,
      sl.created_at AS link_created_at,
      CASE
        WHEN sl.source_story_id = p_story_id THEN sl.target_story_id
        ELSE sl.source_story_id
      END AS linked_story_id,
      CASE
        WHEN sl.source_story_id = p_story_id THEN 'outgoing'
        ELSE 'incoming'
      END AS direction,
      ps.title AS linked_story_title,
      ps.delivery_status AS linked_delivery_status,
      ps.tech_stack AS linked_tech_stack,
      ps.domain AS linked_domain,
      (
        SELECT count(*)::int
        FROM public.story_participants sp2
        WHERE sp2.story_id = CASE
          WHEN sl.source_story_id = p_story_id THEN sl.target_story_id
          ELSE sl.source_story_id
        END
      ) AS linked_participant_count
    FROM public.story_links sl
    JOIN public.partner_stories ps
      ON ps.id = CASE
        WHEN sl.source_story_id = p_story_id THEN sl.target_story_id
        ELSE sl.source_story_id
      END
    WHERE (sl.source_story_id = p_story_id OR sl.target_story_id = p_story_id)
    ORDER BY sl.created_at DESC
  ) t;

  RETURN v_result;
END;
$function$;

REVOKE ALL ON FUNCTION public.get_linked_stories(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_linked_stories(uuid) TO authenticated;
