-- ============================================================================
-- Source of Truth: fn_get_run_graph_context
-- Step:  Step 7.3 (Hippocampus explainability panel)
-- Used by: src/hooks/useRunGraphContext.ts → src/components/chat/ExplainabilityPanel.tsx
-- Migration: aisha/db/migrations/20260520050000_run_graph_context.sql
-- ============================================================================

CREATE OR REPLACE FUNCTION public.fn_get_run_graph_context(
  p_run_id     uuid,
  p_depth      integer DEFAULT NULL,
  p_per_seed   integer DEFAULT NULL
)
RETURNS TABLE (
  seed_node_id          uuid,
  seed_entity_type      text,
  seed_label            text,
  target_node_id        uuid,
  target_entity_type    text,
  target_label          text,
  depth                 integer,
  cumulative_confidence numeric,
  last_relationship     text,
  path                  uuid[]
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
STABLE
AS $$
DECLARE
  v_story_id      uuid;
  v_chunk_ids     uuid[];
  v_profile_slug  text;
  v_eff_depth     integer;
  v_eff_per_seed  integer;
BEGIN
  IF auth.uid() IS NULL AND current_setting('role', true) != 'service_role' THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '22023';
  END IF;
  IF p_depth IS NOT NULL AND (p_depth < 1 OR p_depth > 4) THEN
    RAISE EXCEPTION 'p_depth must be 1..4';
  END IF;
  IF p_per_seed IS NOT NULL AND (p_per_seed < 1 OR p_per_seed > 50) THEN
    RAISE EXCEPTION 'p_per_seed must be 1..50';
  END IF;

  SELECT ar.story_id,
         ar.citation_chunk_ids,
         (ar.metadata->'context'->>'profile_slug')
    INTO v_story_id, v_chunk_ids, v_profile_slug
    FROM public.ai_runs ar
   WHERE ar.id = p_run_id;

  IF NOT FOUND THEN
    RETURN;
  END IF;

  IF current_setting('role', true) != 'service_role' THEN
    IF v_story_id IS NOT NULL THEN
      IF NOT EXISTS (
        SELECT 1 FROM public.partner_stories ps
         WHERE ps.id = v_story_id
           AND (public.is_admin_or_staff(auth.uid())
                OR ps.is_stack_default = true
                OR ps.user_id = auth.uid()
                OR EXISTS (SELECT 1 FROM public.story_participants sp
                            WHERE sp.story_id = ps.id AND sp.user_id = auth.uid()))
      ) THEN
        RETURN;
      END IF;
    END IF;
  END IF;

  SELECT COALESCE(p_depth,    cp.graph_depth,    2),
         COALESCE(p_per_seed, cp.graph_per_seed, 10)
    INTO v_eff_depth, v_eff_per_seed
    FROM (SELECT v_profile_slug AS slug) sub
    LEFT JOIN public.context_profiles cp ON cp.slug = sub.slug AND cp.is_active = true;

  v_eff_depth    := COALESCE(v_eff_depth, 2);
  v_eff_per_seed := COALESCE(v_eff_per_seed, 10);

  IF v_chunk_ids IS NULL OR array_length(v_chunk_ids, 1) IS NULL THEN
    RETURN;
  END IF;

  RETURN QUERY
  WITH seeds AS (
    SELECT DISTINCT ON (gn.id)
           gn.id AS seed_id,
           gn.entity_type AS seed_type,
           gn.entity_label AS seed_label
      FROM public.knowledge_chunks kc
      JOIN public.knowledge_items ki ON ki.id = kc.knowledge_item_id
      JOIN public.graph_nodes gn
        ON gn.source_table = 'knowledge_items'
       AND gn.source_id = ki.id
     WHERE kc.id = ANY(v_chunk_ids)
     ORDER BY gn.id,
              (gn.story_id IS NOT DISTINCT FROM v_story_id) DESC,
              gn.created_at ASC
  ),
  hops AS (
    SELECT s.seed_id, s.seed_type, s.seed_label, h.*
      FROM seeds s
      CROSS JOIN LATERAL public.fn_graph_multihop(
        s.seed_id,
        v_eff_depth,
        NULL::text[],
        v_story_id,
        v_eff_per_seed
      ) h
     WHERE h.depth > 0
  )
  SELECT seed_id, seed_type, seed_label,
         target_id, target_type, target_label,
         hops.depth, cumulative_confidence, last_relationship, path
    FROM hops
   ORDER BY cumulative_confidence DESC NULLS LAST, hops.depth ASC, target_label ASC;
END;
$$;

REVOKE ALL ON FUNCTION public.fn_get_run_graph_context(uuid, integer, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.fn_get_run_graph_context(uuid, integer, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.fn_get_run_graph_context(uuid, integer, integer) TO service_role;

COMMENT ON FUNCTION public.fn_get_run_graph_context(uuid, integer, integer) IS
  'Step 7.3: returns the multi-hop graph context for an ai_run — what concepts/rules/memories the cited knowledge items connect to. Depth + per_seed resolved server-side from context_profiles via ai_runs.metadata.context.profile_slug. Story-scoped RBAC via partner_stories.user_id.';
