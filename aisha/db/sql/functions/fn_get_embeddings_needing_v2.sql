-- ============================================================================
-- Source of Truth: fn_get_embeddings_needing_v2
-- Step:  Step 3 of retrieval optimization plan 2026
-- Used by: services/svc-mcp-knowledge/src/routes/knowledge-embeddings.ts
--          (POST /embeddings/v2-backfill) + WF_EMBEDDING_V2_BACKFILL
-- Migration: aisha/db/migrations/20260518230000_embedding_v2_qwen3.sql
-- ============================================================================

-- Brick3 locale axis: locale added to RETURNS TABLE (sourced from the embedding
-- row, which the v2 writer scopes its UPDATE by). Appending an OUT column changes
-- the result shape, so the old definition must be DROPped before CREATE.
DROP FUNCTION IF EXISTS public.fn_get_embeddings_needing_v2(integer, uuid);

CREATE OR REPLACE FUNCTION public.fn_get_embeddings_needing_v2(
  p_batch_size integer DEFAULT 50,
  p_item_id    uuid    DEFAULT NULL
)
RETURNS TABLE (
  embedding_id        uuid,
  chunk_id            uuid,
  knowledge_item_id   uuid,
  chunk_text          text,
  contextual_prefix   text,
  locale              text
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
  SELECT ke.id, ke.chunk_id, ke.knowledge_item_id, kc.chunk_text, kc.contextual_prefix, ke.locale
    FROM public.knowledge_embeddings ke
    JOIN public.knowledge_chunks kc ON kc.id = ke.chunk_id
   WHERE ke.v2_status = 'pending'
     AND (p_item_id IS NULL OR ke.knowledge_item_id = p_item_id)
   ORDER BY ke.chunk_id
   LIMIT p_batch_size;
END;
$$;

REVOKE ALL ON FUNCTION public.fn_get_embeddings_needing_v2(integer, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.fn_get_embeddings_needing_v2(integer, uuid) TO service_role;
