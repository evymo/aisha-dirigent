/**
 * get_story_graph
 *
 * Returns a recursive graph of linked stories up to a configurable depth (max 3).
 * Uses a CTE to traverse accepted links and returns story metadata at each node.
 * Prevents cycles via path tracking.
 *
 * @param p_max_depth - Maximum traversal depth (capped at 3)
 * @param p_story_id - UUID of the root story
 * @returns jsonb - Array of graph node objects with depth, link info, and story metadata
 */
CREATE OR REPLACE FUNCTION public.get_story_graph(
  p_max_depth int DEFAULT 3,
  p_story_id uuid DEFAULT NULL
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

  IF p_max_depth > 3 THEN
    p_max_depth := 3;
  END IF;

  WITH RECURSIVE story_graph AS (
    SELECT
      sl.id AS link_id,
      sl.source_story_id,
      sl.target_story_id,
      sl.link_type,
      sl.confidence_score,
      CASE
        WHEN sl.source_story_id = p_story_id THEN sl.target_story_id
        ELSE sl.source_story_id
      END AS connected_story_id,
      1 AS depth,
      ARRAY[p_story_id, CASE
        WHEN sl.source_story_id = p_story_id THEN sl.target_story_id
        ELSE sl.source_story_id
      END] AS path
    FROM public.story_links sl
    WHERE (sl.source_story_id = p_story_id OR sl.target_story_id = p_story_id)
      AND sl.is_accepted = true

    UNION ALL

    SELECT
      sl2.id AS link_id,
      sl2.source_story_id,
      sl2.target_story_id,
      sl2.link_type,
      sl2.confidence_score,
      CASE
        WHEN sl2.source_story_id = sg.connected_story_id THEN sl2.target_story_id
        ELSE sl2.source_story_id
      END AS connected_story_id,
      sg.depth + 1 AS depth,
      sg.path || CASE
        WHEN sl2.source_story_id = sg.connected_story_id THEN sl2.target_story_id
        ELSE sl2.source_story_id
      END
    FROM public.story_links sl2
    JOIN story_graph sg ON (
      sl2.source_story_id = sg.connected_story_id
      OR sl2.target_story_id = sg.connected_story_id
    )
    WHERE sg.depth < p_max_depth
      AND sl2.is_accepted = true
      AND NOT (CASE
        WHEN sl2.source_story_id = sg.connected_story_id THEN sl2.target_story_id
        ELSE sl2.source_story_id
      END = ANY(sg.path))
  )
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'link_id', sg.link_id,
    'link_type', sg.link_type,
    'connected_story_id', sg.connected_story_id,
    'confidence_score', sg.confidence_score,
    'depth', sg.depth,
    'title', ps.title,
    'delivery_status', ps.delivery_status,
    'tech_stack', ps.tech_stack,
    'domain', ps.domain,
    'participant_count', (
      SELECT count(*)::int
      FROM public.story_participants sp
      WHERE sp.story_id = sg.connected_story_id
    )
  ) ORDER BY sg.depth, sg.link_type), '[]'::jsonb)
  INTO v_result
  FROM story_graph sg
  JOIN public.partner_stories ps ON ps.id = sg.connected_story_id;

  RETURN v_result;
END;
$function$;

REVOKE ALL ON FUNCTION public.get_story_graph(int, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_story_graph(int, uuid) TO authenticated;
