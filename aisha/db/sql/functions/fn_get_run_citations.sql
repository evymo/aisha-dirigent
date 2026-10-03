-- ============================================================================
-- Source of Truth: fn_get_run_citations
-- Step:  Step 2 of retrieval optimization plan 2026
-- Used by: src/hooks/useRunCitations.ts → CitationPanel.tsx
-- Migration: aisha/db/migrations/20260518220000_chat_message_eval_link.sql
-- Patched by: aisha/db/migrations/20260519030000_fix_owner_user_id_typo.sql
--             (ps.owner_user_id → ps.user_id — partner_stories.owner_user_id
--             was never a column; the canonical owner reference is user_id).
-- Patched by: aisha/db/migrations/20260520060000_rbac_4clause_unification.sql
--             (added is_stack_default clause so the predicate matches the
--             workbench Phase 6/7 canonical pattern).
-- ============================================================================

CREATE OR REPLACE FUNCTION public.fn_get_run_citations(p_run_id uuid)
RETURNS TABLE (
  chunk_id            uuid,
  chunk_index         integer,
  chunk_text          text,
  contextual_prefix   text,
  item_id             uuid,
  item_title          text,
  item_type           text,
  section_title       text,
  story_id            uuid,
  relevance_score     numeric,
  attribution_weight  numeric,
  usage_intensity     numeric
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

  RETURN QUERY
  WITH attrs AS (
    SELECT
      knowledge_item_id,
      relevance_score,
      attribution_weight,
      usage_intensity
    FROM public.knowledge_attribution
    WHERE ai_run_id = p_run_id
  ),
  candidate_chunks AS (
    SELECT
      kc.id AS chunk_id,
      kc.chunk_index,
      kc.chunk_text,
      kc.contextual_prefix,
      ki.id AS item_id,
      ki.title AS item_title,
      ki.item_type AS item_type,
      kc.section_title,
      ki.story_id AS story_id,
      a.relevance_score,
      a.attribution_weight,
      a.usage_intensity
    FROM attrs a
    JOIN public.knowledge_items ki ON ki.id = a.knowledge_item_id
    LEFT JOIN public.knowledge_chunks kc ON kc.knowledge_item_id = ki.id
   WHERE ki.status = 'active'
  )
  SELECT
    chunk_id,
    chunk_index,
    chunk_text,
    contextual_prefix,
    item_id,
    item_title,
    item_type,
    section_title,
    story_id,
    relevance_score,
    attribution_weight,
    usage_intensity
  FROM candidate_chunks
   WHERE story_id IS NULL
      OR EXISTS (
           SELECT 1
             FROM public.partner_stories ps
            WHERE ps.id = candidate_chunks.story_id
              AND (
                public.is_admin_or_staff(auth.uid())
                OR ps.is_stack_default = true
                OR ps.user_id = auth.uid()
                OR EXISTS (
                     SELECT 1 FROM public.story_participants sp
                      WHERE sp.story_id = ps.id AND sp.user_id = auth.uid()
                   )
              )
         )
   ORDER BY attribution_weight DESC NULLS LAST, chunk_index ASC;
END;
$$;

REVOKE ALL ON FUNCTION public.fn_get_run_citations(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.fn_get_run_citations(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.fn_get_run_citations(uuid) TO service_role;

COMMENT ON FUNCTION public.fn_get_run_citations(uuid) IS
  'Step 2: returns chunks the ai_run cited (via knowledge_attribution). Story-scoped RBAC via unified 4-clause predicate (admin/staff, stack_default, story owner, or participant).';
