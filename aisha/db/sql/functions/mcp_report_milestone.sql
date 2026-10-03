-- Function: public.mcp_report_milestone
-- Arguments: p_session_id uuid, p_name text, p_evidence jsonb
-- Security: SECURITY DEFINER (logs progress to moderation_decisions)
-- Source: hand-authored; deploy via migration 20260501000000_dirigent_supervisor.sql
--
-- Purpose: Agent reports a milestone reached during work (e.g. "RPC implemented",
--          "RLS policy added"). This feeds the Stop hook goal_evaluator and gives
--          the user a checkpoint timeline. Pure logging — no decision returned.

CREATE OR REPLACE FUNCTION public.mcp_report_milestone(
  p_session_id uuid,
  p_name text,
  p_evidence jsonb DEFAULT '{}'::jsonb
)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_decision_id uuid;
BEGIN
  -- Auth: require authenticated caller (writes to moderation_decisions)
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  IF p_session_id IS NULL OR coalesce(trim(p_name), '') = '' THEN
    RETURN jsonb_build_object('error', 'session_id and non-empty name required');
  END IF;

  INSERT INTO moderation_decisions (
    session_id, decision_type, severity, context, recommendation, evidence, accepted
  ) VALUES (
    p_session_id,
    'milestone_log',
    'info',
    jsonb_build_object('milestone', p_name, 'reported_at', now()),
    'Agent reached milestone: ' || p_name,
    coalesce(p_evidence, '{}'::jsonb),
    true  -- self-reported milestones are accepted unless retracted
  )
  RETURNING id INTO v_decision_id;

  RETURN jsonb_build_object(
    'decision_id', v_decision_id,
    'milestone', p_name,
    'recorded_at', now()
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.mcp_report_milestone(uuid, text, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.mcp_report_milestone(uuid, text, jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.mcp_report_milestone(uuid, text, jsonb) TO service_role;
