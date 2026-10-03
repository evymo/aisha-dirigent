-- Function: public.get_eval_runs_admin
-- Arguments: p_agent_config_id uuid, p_limit integer
-- Description: List AI evaluation runs with aggregated scores
-- Security: SECURITY DEFINER, admin/staff only
-- Source: supabase/migrations/20260302100000_phase3_evaluation_system.sql

CREATE OR REPLACE FUNCTION public.get_eval_runs_admin(
  p_agent_config_id uuid DEFAULT NULL,
  p_limit integer DEFAULT 20
)
RETURNS TABLE (
  id uuid,
  trigger_type text,
  agent_config_id uuid,
  agent_config_version integer,
  status text,
  total_examples integer,
  completed_examples integer,
  avg_relevance numeric,
  avg_groundedness numeric,
  avg_safety numeric,
  avg_coherence numeric,
  avg_overall numeric,
  score_delta numeric,
  previous_run_id uuid,
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz,
  created_by uuid
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
    er.id, er.trigger_type, er.agent_config_id, er.agent_config_version,
    er.status, er.total_examples, er.completed_examples,
    er.avg_relevance, er.avg_groundedness, er.avg_safety,
    er.avg_coherence, er.avg_overall, er.score_delta,
    er.previous_run_id, er.started_at, er.completed_at,
    er.created_at, er.created_by
  FROM ai_eval_runs er
  WHERE (p_agent_config_id IS NULL OR er.agent_config_id = p_agent_config_id)
  ORDER BY er.created_at DESC
  LIMIT p_limit;
END;
$$;

REVOKE ALL ON FUNCTION public.get_eval_runs_admin(uuid, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_eval_runs_admin(uuid, integer) TO authenticated;
