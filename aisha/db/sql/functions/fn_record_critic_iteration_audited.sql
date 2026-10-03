-- Source of Truth: fn_record_critic_iteration_audited (Step 5)
-- Used by services/svc-ai-chat/src/lib/criticLoop.ts
-- Behavior: logs critic iteration AND propagates final faithfulness to
--           ai_runs.faithfulness_score_estimate on terminal decisions
--           (stop_threshold_met / stop_iter_cap) — so Step 2 UI
--           useRunFaithfulness reads the right value.
-- Migrations: 20260518250000_critic_loop.sql (table + initial RPC)
--             20260519010000_critic_iteration_updates_ai_run.sql (ai_runs propagation)

CREATE OR REPLACE FUNCTION public.fn_record_critic_iteration_audited(
  p_run_id              uuid,
  p_iteration           smallint,
  p_faithfulness        numeric,
  p_context_recall      numeric,
  p_retrieved_chunk_ids uuid[],
  p_retrieval_strategy  text,
  p_decision            text,
  p_judge_model         text,
  p_judge_provider_slug text,
  p_metadata            jsonb
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE v_id uuid;
BEGIN
  IF auth.uid() IS NULL AND current_setting('role', true) != 'service_role' THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '22023';
  END IF;
  IF p_run_id IS NULL THEN RAISE EXCEPTION 'p_run_id is required'; END IF;
  IF p_iteration IS NULL THEN RAISE EXCEPTION 'p_iteration is required'; END IF;

  INSERT INTO public.ai_run_critic_iterations (
    ai_run_id, iteration, faithfulness_estimate, context_recall_estimate,
    retrieved_chunk_ids, retrieval_strategy, decision,
    judge_model, judge_provider_slug, metadata
  ) VALUES (
    p_run_id, p_iteration, p_faithfulness, p_context_recall,
    COALESCE(p_retrieved_chunk_ids, '{}'::uuid[]), p_retrieval_strategy, p_decision,
    p_judge_model, p_judge_provider_slug, COALESCE(p_metadata, '{}'::jsonb)
  )
  ON CONFLICT (ai_run_id, iteration) DO UPDATE
    SET faithfulness_estimate = EXCLUDED.faithfulness_estimate,
        context_recall_estimate = EXCLUDED.context_recall_estimate,
        retrieved_chunk_ids = EXCLUDED.retrieved_chunk_ids,
        retrieval_strategy = EXCLUDED.retrieval_strategy,
        decision = EXCLUDED.decision,
        judge_model = EXCLUDED.judge_model,
        judge_provider_slug = EXCLUDED.judge_provider_slug,
        metadata = EXCLUDED.metadata
  RETURNING id INTO v_id;

  -- Step 5 micro-fix (migration 20260519010000): propagate FINAL faithfulness
  -- to ai_runs.faithfulness_score_estimate on terminal decisions so Step 2
  -- UI useRunFaithfulness reads the right value. Non-terminal 'continue'
  -- iterations don't update because they're not the final answer score.
  IF p_decision LIKE 'stop_%' AND p_faithfulness IS NOT NULL THEN
    UPDATE public.ai_runs
       SET faithfulness_score_estimate = p_faithfulness
     WHERE id = p_run_id;
  END IF;

  INSERT INTO public.audit_journal (user_id, action, metadata)
  VALUES (auth.uid(), 'hippocampus.critic_iteration',
    jsonb_build_object('iteration_id', v_id, 'run_id', p_run_id,
      'iteration', p_iteration, 'decision', p_decision,
      'strategy', p_retrieval_strategy, 'faithfulness', p_faithfulness,
      'judge_model', p_judge_model, 'judge_provider', p_judge_provider_slug,
      'propagated_to_ai_run', p_decision LIKE 'stop_%' AND p_faithfulness IS NOT NULL));

  RETURN v_id;
END;
$$;

REVOKE ALL ON FUNCTION public.fn_record_critic_iteration_audited(uuid, smallint, numeric, numeric, uuid[], text, text, text, text, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.fn_record_critic_iteration_audited(uuid, smallint, numeric, numeric, uuid[], text, text, text, text, jsonb) TO service_role;
