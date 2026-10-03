-- Function: public.get_eval_results_admin
-- Arguments: p_eval_run_id uuid, p_limit integer
-- Description: List AI evaluation results for a specific run with per-message scores
-- Security: SECURITY DEFINER, admin/staff only
-- Source: supabase/migrations/20260302100000_phase3_evaluation_system.sql

CREATE OR REPLACE FUNCTION public.get_eval_results_admin(
  p_eval_run_id uuid,
  p_limit integer DEFAULT 100
)
RETURNS TABLE (
  id uuid,
  message_id uuid,
  conversation_id uuid,
  relevance_score numeric,
  groundedness_score numeric,
  safety_score numeric,
  coherence_score numeric,
  overall_score numeric,
  reasoning text,
  evaluator_model text,
  tokens_used integer,
  latency_ms integer,
  created_at timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  IF NOT is_admin_or_staff() THEN
    RAISE EXCEPTION 'Admin or staff role required';
  END IF;

  RETURN QUERY
  SELECT
    r.id, r.message_id, r.conversation_id,
    r.relevance_score, r.groundedness_score, r.safety_score,
    r.coherence_score, r.overall_score, r.reasoning,
    r.evaluator_model, r.tokens_used, r.latency_ms, r.created_at
  FROM ai_eval_results r
  WHERE r.eval_run_id = p_eval_run_id
  ORDER BY r.overall_score ASC
  LIMIT p_limit;
END;
$$;

REVOKE ALL ON FUNCTION public.get_eval_results_admin(uuid, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_eval_results_admin(uuid, integer) TO authenticated;
