-- ============================================================================
-- Source of Truth: fn_get_run_faithfulness
-- Step:  Step 2 of retrieval optimization plan 2026
-- Used by: src/hooks/useRunFaithfulness.ts → FaithfulnessChip.tsx
-- Migration: aisha/db/migrations/20260518220000_chat_message_eval_link.sql
-- ============================================================================

CREATE OR REPLACE FUNCTION public.fn_get_run_faithfulness(p_run_id uuid)
RETURNS TABLE (
  run_id        uuid,
  faithfulness  numeric,
  citation_count integer,
  computed_at   timestamptz
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
  SELECT ar.id,
         ar.faithfulness_score_estimate,
         COALESCE(array_length(ar.citation_chunk_ids, 1), 0)::integer,
         ar.updated_at
    FROM public.ai_runs ar
   WHERE ar.id = p_run_id
     AND (
       ar.actor_user_id = auth.uid()
       OR public.is_admin_or_staff(auth.uid())
       OR current_setting('role', true) = 'service_role'
     );
END;
$$;

REVOKE ALL ON FUNCTION public.fn_get_run_faithfulness(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.fn_get_run_faithfulness(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.fn_get_run_faithfulness(uuid) TO service_role;

COMMENT ON FUNCTION public.fn_get_run_faithfulness(uuid) IS
  'Step 2: faithfulness + citation count for one ai_run. Owner / admin / service_role only.';
