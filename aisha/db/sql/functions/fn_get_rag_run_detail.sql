-- ============================================================================
-- Source of Truth: fn_get_rag_run_detail
-- Popis: Detail view for a single rag_eval_runs row joined with its
--        rag_eval_golden source. Used by admin drill-down (future step) and
--        regression debugging (which run scored 0.4 on faithfulness?).
--
-- Step:  Step 0 of retrieval optimization plan 2026
-- Bezpečnost: SECURITY DEFINER + admin-or-staff (or service_role)
-- Audit:  N/A — read-only single-row lookup, no audit row to avoid log spam
-- Source migration: aisha/db/migrations/20260518200000_rag_eval_foundation.sql
-- ============================================================================

-- A currency-suffixed name (`*_usd`) was removed from this function's signature.
-- The TYPES did not change, so CREATE OR REPLACE matches the deployed function and
-- Postgres refuses to rename in place ("cannot change name of input parameter", or
-- "cannot change return type" when the renamed name is a RETURNS TABLE column).
-- DROP-first is the convention used elsewhere in this directory; the REVOKE/GRANT
-- below re-applies whatever privileges the drop clears.
DROP FUNCTION IF EXISTS public.fn_get_rag_run_detail(uuid);

CREATE OR REPLACE FUNCTION public.fn_get_rag_run_detail(p_run_id uuid)
RETURNS TABLE (
  run_id                  uuid,
  golden_id               uuid,
  golden_slug             text,
  question                text,
  ground_truth_answer     text,
  generated_answer        text,
  context_profile_slug    text,
  embedding_model         text,
  llm_model               text,
  retrieved_chunk_ids     uuid[],
  faithfulness_score      numeric,
  answer_relevancy_score  numeric,
  context_precision_score numeric,
  context_recall_score    numeric,
  composite_score         numeric,
  latency_ms              integer,
  cost                numeric,
  metadata                jsonb,
  created_at              timestamptz
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
  IF NOT (public.is_admin_or_staff(auth.uid()) OR current_setting('role', true) = 'service_role') THEN
    RAISE EXCEPTION 'Admin/staff or service_role required' USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  SELECT
    r.id, g.id, g.slug, g.question, g.ground_truth_answer, r.generated_answer,
    r.context_profile_slug, r.embedding_model, r.llm_model, r.retrieved_chunk_ids,
    r.faithfulness_score, r.answer_relevancy_score,
    r.context_precision_score, r.context_recall_score, r.composite_score,
    r.latency_ms, r.cost, r.metadata, r.created_at
  FROM public.rag_eval_runs r
  JOIN public.rag_eval_golden g ON g.id = r.golden_id
  WHERE r.id = p_run_id;
END;
$$;

REVOKE ALL ON FUNCTION public.fn_get_rag_run_detail(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.fn_get_rag_run_detail(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.fn_get_rag_run_detail(uuid) TO service_role;

COMMENT ON FUNCTION public.fn_get_rag_run_detail(uuid) IS
  'Detail view for a single eval run: golden question + generated answer + all 4 scores + chunk IDs.';
