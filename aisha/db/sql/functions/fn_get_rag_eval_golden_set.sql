-- ============================================================================
-- Source of Truth: fn_get_rag_eval_golden_set
-- Popis: Returns the active golden Q/A set for the nightly RAG eval pipeline.
--        Optional filters by context_profile_slug and language. Used by:
--          - services/svc-mcp-knowledge/src/routes/rag-eval.ts → POST /rag/eval/run
--
-- Step:  Step 0 of retrieval optimization plan 2026
-- Bezpečnost: SECURITY DEFINER + authenticated/service_role
-- Audit:  N/A — read-only fetch, no audit row to avoid log spam per batch
-- Source migration: aisha/db/migrations/20260518200000_rag_eval_foundation.sql
-- ============================================================================

CREATE OR REPLACE FUNCTION public.fn_get_rag_eval_golden_set(
  p_profile_slug text DEFAULT NULL,
  p_language     text DEFAULT NULL,
  p_limit        integer DEFAULT NULL
)
RETURNS TABLE (
  id                   uuid,
  slug                 text,
  question             text,
  ground_truth_answer  text,
  expected_chunk_slugs text[],
  context_profile_slug text,
  expertise_area_slug  text,
  story_id             uuid,
  difficulty           smallint,
  language             text,
  tags                 text[]
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
  SELECT g.id, g.slug, g.question, g.ground_truth_answer,
         g.expected_chunk_slugs, g.context_profile_slug, g.expertise_area_slug,
         g.story_id, g.difficulty, g.language, g.tags
    FROM public.rag_eval_golden g
   WHERE g.status = 'active'
     AND (p_profile_slug IS NULL OR g.context_profile_slug = p_profile_slug)
     AND (p_language IS NULL OR g.language = p_language)
   ORDER BY g.context_profile_slug NULLS LAST, g.difficulty ASC NULLS LAST, g.slug
   LIMIT COALESCE(p_limit, 1000);
END;
$$;

REVOKE ALL ON FUNCTION public.fn_get_rag_eval_golden_set(text, text, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.fn_get_rag_eval_golden_set(text, text, integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.fn_get_rag_eval_golden_set(text, text, integer) TO authenticated;

COMMENT ON FUNCTION public.fn_get_rag_eval_golden_set(text, text, integer) IS
  'WF_RAG_EVAL_NIGHTLY discovery RPC — active golden set, optionally filtered by profile/language.';
