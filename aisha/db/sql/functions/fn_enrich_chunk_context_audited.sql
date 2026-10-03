-- ============================================================================
-- Source of Truth: fn_enrich_chunk_context_audited
-- Popis: Persist a contextual prefix for one chunk + invalidate its existing
--        embedding so the next embedding worker pass re-embeds over
--        {contextual_prefix} {chunk_text}. Audit row written.
-- Caller: services/svc-mcp-knowledge/src/lib/contextual-prefix.ts → batch loop
--         after vLLM generates the prefix
--
-- Why invalidate the embedding:
--   Step 1's contract is that embedding MUST reflect the prefix. Without
--   invalidation, a re-run of the prefix worker would leave the old
--   prefix-less embedding behind, and queries would still hit the worse
--   baseline. The downstream embedding worker picks up the orphaned chunk on
--   its next pass and re-embeds with the prefix included as input.
--
-- Step:   Step 1 of retrieval optimization plan 2026
-- Bezpečnost: SECURITY DEFINER + service_role only
-- Audit:  INSERT INTO audit_journal (action='knowledge.chunk_context_enriched', metadata)
-- Source migration: aisha/db/migrations/20260518210000_contextual_retrieval.sql
-- ============================================================================

CREATE OR REPLACE FUNCTION public.fn_enrich_chunk_context_audited(
  p_chunk_id           uuid,
  p_contextual_prefix  text,
  p_model              text,
  p_model_version      text,
  p_token_count        integer
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_item_id uuid;
  v_deleted_embeddings integer;
BEGIN
  IF auth.uid() IS NULL AND current_setting('role', true) != 'service_role' THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '22023';
  END IF;

  IF p_chunk_id IS NULL THEN
    RAISE EXCEPTION 'p_chunk_id is required';
  END IF;
  IF p_contextual_prefix IS NULL OR length(trim(p_contextual_prefix)) = 0 THEN
    RAISE EXCEPTION 'p_contextual_prefix must be non-empty';
  END IF;
  IF p_model IS NULL OR p_model = '' THEN
    RAISE EXCEPTION 'p_model is required';
  END IF;

  SELECT knowledge_item_id INTO v_item_id
    FROM public.knowledge_chunks
   WHERE id = p_chunk_id;

  IF v_item_id IS NULL THEN
    RAISE EXCEPTION 'chunk % not found', p_chunk_id;
  END IF;

  UPDATE public.knowledge_chunks
     SET contextual_prefix               = p_contextual_prefix,
         contextual_prefix_model         = p_model,
         contextual_prefix_model_version = p_model_version,
         contextual_prefix_token_count   = p_token_count,
         contextual_prefix_generated_at  = now()
   WHERE id = p_chunk_id;

  DELETE FROM public.knowledge_embeddings
   WHERE chunk_id = p_chunk_id;
  GET DIAGNOSTICS v_deleted_embeddings = ROW_COUNT;

  INSERT INTO public.audit_journal (user_id, action, metadata)
  VALUES (
    auth.uid(),
    'knowledge.chunk_context_enriched',
    jsonb_build_object(
      'chunk_id',  p_chunk_id,
      'item_id',   v_item_id,
      'model',     p_model,
      'version',   p_model_version,
      'tokens',    p_token_count,
      'prefix_chars', length(p_contextual_prefix),
      'embeddings_invalidated', v_deleted_embeddings
    )
  );
END;
$$;

REVOKE ALL ON FUNCTION public.fn_enrich_chunk_context_audited(uuid, text, text, text, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.fn_enrich_chunk_context_audited(uuid, text, text, text, integer) TO service_role;

COMMENT ON FUNCTION public.fn_enrich_chunk_context_audited(uuid, text, text, text, integer) IS
  'Persist contextual prefix for one chunk + invalidate its existing embedding so the next embedding worker pass re-embeds {prefix} {chunk_text}. Audit row written. Service-role only.';
