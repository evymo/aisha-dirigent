-- Function: insert_eval_result
-- Description: Inserts an evaluation result for an AI eval run
-- Security: SECURITY DEFINER

CREATE OR REPLACE FUNCTION public.insert_eval_result(
  p_eval_run_id uuid,
  p_message_id uuid DEFAULT NULL::uuid,
  p_conversation_id uuid DEFAULT NULL::uuid,
  p_relevance numeric DEFAULT 0,
  p_groundedness numeric DEFAULT 0,
  p_safety numeric DEFAULT 0,
  p_coherence numeric DEFAULT 0,
  p_overall numeric DEFAULT 0,
  p_reasoning text DEFAULT NULL::text,
  p_evaluator_model text DEFAULT 'gpt-4o-mini'::text,
  p_tokens_used integer DEFAULT NULL::integer,
  p_latency_ms integer DEFAULT NULL::integer,
  p_golden_example_id uuid DEFAULT NULL::uuid
)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_result_id uuid;
  v_completed integer;
  v_total integer;
  v_is_service BOOLEAN;
BEGIN
  v_is_service := public.is_service_role();
  IF NOT v_is_service AND NOT is_admin_or_staff() THEN
    RAISE EXCEPTION 'Service role or admin required';
  END IF;

  INSERT INTO ai_eval_results (
    eval_run_id, message_id, conversation_id, golden_example_id,
    relevance_score, groundedness_score, safety_score,
    coherence_score, overall_score, reasoning,
    evaluator_model, tokens_used, latency_ms
  ) VALUES (
    p_eval_run_id, p_message_id, p_conversation_id, p_golden_example_id,
    p_relevance, p_groundedness, p_safety,
    p_coherence, p_overall, p_reasoning,
    p_evaluator_model, p_tokens_used, p_latency_ms
  )
  RETURNING id INTO v_result_id;

  -- Update the message's eval_score (only if message_id provided)
  IF p_message_id IS NOT NULL THEN
    UPDATE chat_messages
    SET eval_score = jsonb_build_object(
      'relevance', p_relevance,
      'groundedness', p_groundedness,
      'safety', p_safety,
      'coherence', p_coherence,
      'overall', p_overall,
      'eval_run_id', p_eval_run_id,
      'evaluated_at', now()
    )
    WHERE id = p_message_id;
  END IF;

  -- Update run progress + aggregates
  SELECT COUNT(*) INTO v_completed FROM ai_eval_results WHERE eval_run_id = p_eval_run_id;
  SELECT total_examples INTO v_total FROM ai_eval_runs WHERE id = p_eval_run_id;

  UPDATE ai_eval_runs
  SET completed_examples = v_completed,
      status = CASE WHEN v_completed >= v_total THEN 'completed' ELSE 'running' END,
      started_at = COALESCE(started_at, now()),
      completed_at = CASE WHEN v_completed >= v_total THEN now() ELSE NULL END,
      avg_relevance = sub.avg_r,
      avg_groundedness = sub.avg_g,
      avg_safety = sub.avg_s,
      avg_coherence = sub.avg_c,
      avg_overall = sub.avg_o
  FROM (
    SELECT
      AVG(relevance_score) AS avg_r,
      AVG(groundedness_score) AS avg_g,
      AVG(safety_score) AS avg_s,
      AVG(coherence_score) AS avg_c,
      AVG(overall_score) AS avg_o
    FROM ai_eval_results
    WHERE eval_run_id = p_eval_run_id
  ) sub
  WHERE ai_eval_runs.id = p_eval_run_id;

  -- When run is completed, compute score_delta vs previous run
  IF v_completed >= v_total THEN
    UPDATE ai_eval_runs er
    SET score_delta = er.avg_overall - prev.avg_overall
    FROM ai_eval_runs prev
    WHERE er.id = p_eval_run_id
      AND prev.id = er.previous_run_id
      AND prev.avg_overall IS NOT NULL;
  END IF;

  RETURN v_result_id;
END;
$function$;

-- Permissions
REVOKE ALL ON FUNCTION public.insert_eval_result(uuid,uuid,uuid,numeric,numeric,numeric,numeric,numeric,text,text,integer,integer,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.insert_eval_result(uuid,uuid,uuid,numeric,numeric,numeric,numeric,numeric,text,text,integer,integer,uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.insert_eval_result(uuid,uuid,uuid,numeric,numeric,numeric,numeric,numeric,text,text,integer,integer,uuid) TO service_role;
