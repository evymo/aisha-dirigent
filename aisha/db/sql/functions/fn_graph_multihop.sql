-- Source of Truth: fn_graph_multihop (Step 7)
-- Used by src/hooks/useRunGraphContext.ts (next-PR explainability panel)
-- and compose_context graph_context layer (Step 7.3 follow-up).
-- Migration: aisha/db/migrations/20260518270000_hippocampus_graph.sql

CREATE OR REPLACE FUNCTION public.fn_graph_multihop(
  p_start_node_id   uuid,
  p_max_depth       integer DEFAULT 3,
  p_relationships   text[]  DEFAULT NULL,
  p_story_id        uuid    DEFAULT NULL,
  p_limit           integer DEFAULT 50
)
RETURNS TABLE (
  depth                 integer,
  path                  uuid[],
  target_id             uuid,
  target_type           text,
  target_label          text,
  cumulative_confidence numeric,
  last_relationship     text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
STABLE
AS $$
BEGIN
  IF auth.uid() IS NULL AND current_setting('role', true) != 'service_role' THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '22023';
  END IF;
  IF p_max_depth < 1 OR p_max_depth > 6 THEN
    RAISE EXCEPTION 'p_max_depth must be 1..6';
  END IF;

  RETURN QUERY
  WITH RECURSIVE traversal AS (
    SELECT 0 AS depth, ARRAY[p_start_node_id] AS path,
           p_start_node_id AS current_id, 1.0::numeric AS confidence,
           NULL::text AS last_rel
     UNION ALL
    SELECT t.depth + 1, t.path || ge.target_node_id, ge.target_node_id,
           t.confidence * ge.confidence, ge.relationship
      FROM traversal t
      JOIN public.graph_edges ge ON ge.source_node_id = t.current_id
     WHERE t.depth < p_max_depth
       AND NOT (ge.target_node_id = ANY(t.path))
       AND (p_relationships IS NULL OR ge.relationship = ANY(p_relationships))
  )
  SELECT t.depth, t.path, t.current_id, gn.entity_type, gn.entity_label,
         t.confidence, t.last_rel
    FROM traversal t
    JOIN public.graph_nodes gn ON gn.id = t.current_id
   WHERE t.depth > 0
     AND (p_story_id IS NULL OR gn.story_id IS NULL OR gn.story_id = p_story_id)
   ORDER BY t.confidence DESC, t.depth ASC
   LIMIT p_limit;
END;
$$;

REVOKE ALL ON FUNCTION public.fn_graph_multihop(uuid, integer, text[], uuid, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.fn_graph_multihop(uuid, integer, text[], uuid, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.fn_graph_multihop(uuid, integer, text[], uuid, integer) TO service_role;
