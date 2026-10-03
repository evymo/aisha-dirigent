-- ============================================================================
-- Source of Truth: fn_record_rag_eval_run_audited
-- Popis: Persist a single eval run row in public.rag_eval_runs with all 4
--        RAGAS-style scores + audit_journal entry. Called per golden row
--        by services/svc-mcp-knowledge/src/routes/rag-eval.ts.
--
-- Step:   Step 0 of retrieval optimization plan 2026
-- Bezpečnost: SECURITY DEFINER + service_role only
-- Audit:  INSERT INTO audit_journal (action='rag_eval.run_recorded', metadata)
-- Source migration: aisha/db/migrations/20260518200000_rag_eval_foundation.sql
-- ============================================================================

-- A currency-suffixed name (`*_usd`) was removed from this function's signature.
-- The TYPES did not change, so CREATE OR REPLACE matches the deployed function and
-- Postgres refuses to rename in place ("cannot change name of input parameter", or
-- "cannot change return type" when the renamed name is a RETURNS TABLE column).
-- DROP-first is the convention used elsewhere in this directory; the REVOKE/GRANT
-- below re-applies whatever privileges the drop clears.
DROP FUNCTION IF EXISTS public.fn_record_rag_eval_run_audited(uuid, uuid, text, text, text, text, text, uuid[], text, jsonb, integer, numeric, uuid, jsonb);

CREATE OR REPLACE FUNCTION public.fn_record_rag_eval_run_audited(
  p_golden_id                uuid,
  p_batch_id                 uuid,
  p_embedding_model          text,
  p_embedding_model_version  text,
  p_llm_model                text,
  p_judge_model              text,
  p_context_profile_slug     text,
  p_retrieved_chunk_ids      uuid[],
  p_generated_answer         text,
  p_scores                   jsonb,
  p_latency_ms               integer,
  p_cost                 numeric,
  p_ai_run_id                uuid DEFAULT NULL,
  p_metadata                 jsonb DEFAULT '{}'::jsonb
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_run_id uuid;
BEGIN
  IF auth.uid() IS NULL AND current_setting('role', true) != 'service_role' THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '22023';
  END IF;

  IF p_golden_id IS NULL THEN
    RAISE EXCEPTION 'p_golden_id is required';
  END IF;
  IF p_batch_id IS NULL THEN
    RAISE EXCEPTION 'p_batch_id is required';
  END IF;
  IF p_embedding_model IS NULL OR p_embedding_model = '' THEN
    RAISE EXCEPTION 'p_embedding_model is required';
  END IF;
  IF p_llm_model IS NULL OR p_llm_model = '' THEN
    RAISE EXCEPTION 'p_llm_model is required';
  END IF;

  INSERT INTO public.rag_eval_runs (
    golden_id, batch_id, embedding_model, embedding_model_version,
    llm_model, judge_model, context_profile_slug, retrieved_chunk_ids,
    generated_answer,
    faithfulness_score, answer_relevancy_score,
    context_precision_score, context_recall_score,
    latency_ms, cost, metadata, ai_run_id
  ) VALUES (
    p_golden_id, p_batch_id, p_embedding_model, p_embedding_model_version,
    p_llm_model, p_judge_model, p_context_profile_slug, COALESCE(p_retrieved_chunk_ids, '{}'::uuid[]),
    p_generated_answer,
    NULLIF(p_scores->>'faithfulness', '')::numeric,
    NULLIF(p_scores->>'answer_relevancy', '')::numeric,
    NULLIF(p_scores->>'context_precision', '')::numeric,
    NULLIF(p_scores->>'context_recall', '')::numeric,
    p_latency_ms, p_cost, COALESCE(p_metadata, '{}'::jsonb), p_ai_run_id
  )
  RETURNING id INTO v_run_id;

  INSERT INTO public.audit_journal (user_id, action, metadata)
  VALUES (
    auth.uid(),
    'rag_eval.run_recorded',
    jsonb_build_object(
      'run_id', v_run_id,
      'golden_id', p_golden_id,
      'batch_id', p_batch_id,
      'embedding_model', p_embedding_model,
      'llm_model', p_llm_model,
      'profile', p_context_profile_slug,
      'scores', p_scores,
      'chunk_count', COALESCE(array_length(p_retrieved_chunk_ids, 1), 0),
      'latency_ms', p_latency_ms,
      'cost', p_cost
    )
  );

  RETURN v_run_id;
END;
$$;

REVOKE ALL ON FUNCTION public.fn_record_rag_eval_run_audited(uuid, uuid, text, text, text, text, text, uuid[], text, jsonb, integer, numeric, uuid, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.fn_record_rag_eval_run_audited(uuid, uuid, text, text, text, text, text, uuid[], text, jsonb, integer, numeric, uuid, jsonb) TO service_role;
-- service_role ONLY — no end user records an eval run. REVOKE ... FROM PUBLIC does
-- NOT remove a grant made explicitly to a role, so a database that once granted
-- this to authenticated would silently keep it. Revoke by name so the intent
-- reaches an already-deployed instance too (heals-revoke-reaches-existing-db gate).
REVOKE ALL ON FUNCTION public.fn_record_rag_eval_run_audited(uuid, uuid, text, text, text, text, text, uuid[], text, jsonb, integer, numeric, uuid, jsonb) FROM authenticated;
REVOKE ALL ON FUNCTION public.fn_record_rag_eval_run_audited(uuid, uuid, text, text, text, text, text, uuid[], text, jsonb, integer, numeric, uuid, jsonb) FROM anon;

COMMENT ON FUNCTION public.fn_record_rag_eval_run_audited(uuid, uuid, text, text, text, text, text, uuid[], text, jsonb, integer, numeric, uuid, jsonb) IS
  'Persist single eval run with all 4 RAGAS-style scores; writes audit row (rag_eval.run_recorded). Service-role only.';
