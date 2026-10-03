-- Function: public.get_story_aisha_maturity
-- Calculates AISHA maturity score for a story based on 30-day rolling metrics.
-- Composite: webhook reliability (40%), speed (20%), deploy success (20%),
--            compliance (15%), learning activity (5%).
-- Uses dedicated indexes for performance on rolling windows.
-- @security: authenticated (admin/staff via RLS on underlying tables)

CREATE OR REPLACE FUNCTION public.get_story_aisha_maturity(
  p_story_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_webhook_total   integer;
  v_webhook_success integer;
  v_avg_response_ms numeric;
  v_deploy_total    integer;
  v_deploy_success  integer;
  v_compliance_total integer;
  v_compliance_pass  integer;
  v_learning_count  integer;
  v_maturity_score  numeric;
  v_maturity_level  text;
  v_cutoff          timestamptz := now() - interval '30 days';
BEGIN
  -- Webhook reliability (last 30 days) — uses idx_integration_events_maturity_webhook
  SELECT COUNT(*), COUNT(*) FILTER (WHERE status = 'completed')
  INTO v_webhook_total, v_webhook_success
  FROM integration_events
  WHERE story_id = p_story_id
    AND event_source IN ('github_webhook', 'forgejo_webhook')
    AND created_at > v_cutoff;

  -- Average response time — uses idx_integration_events_maturity_duration
  SELECT ROUND(AVG(duration_ms))
  INTO v_avg_response_ms
  FROM integration_events
  WHERE story_id = p_story_id
    AND duration_ms IS NOT NULL
    AND created_at > v_cutoff;

  -- Deployment success rate
  SELECT COUNT(*), COUNT(*) FILTER (WHERE status = 'completed')
  INTO v_deploy_total, v_deploy_success
  FROM integration_events
  WHERE story_id = p_story_id
    AND event_source = 'deployment'
    AND created_at > v_cutoff;

  -- Compliance pass rate — correlate via run_id → ai_runs.story_id (proper join;
  -- replaces fragile request_summary::text ILIKE story_id text-match).
  SELECT COUNT(*), COUNT(*) FILTER (WHERE te.status = 'ok')
  INTO v_compliance_total, v_compliance_pass
  FROM ai_trace_events te
  JOIN ai_runs ar ON ar.id = te.run_id
  WHERE ar.story_id = p_story_id
    AND te.operation ILIKE '%compliance%'
    AND te.created_at > v_cutoff;

  -- Learning activity — real improvement_proposals for this story (correlate via
  -- run_id → ai_runs.story_id or metadata.story_id; replaces fragile
  -- agent_memories content ILIKE story_id text-match).
  SELECT COUNT(*)
  INTO v_learning_count
  FROM improvement_proposals ip
  LEFT JOIN ai_runs ar ON ar.id = ip.run_id
  WHERE (ar.story_id = p_story_id
         OR ip.metadata->>'story_id' = p_story_id::text)
    AND ip.created_at > v_cutoff;

  -- Calculate maturity score (0-100)
  v_maturity_score := (
    COALESCE(v_webhook_success::numeric / NULLIF(v_webhook_total, 0), 0) * 40 +
    GREATEST(0, LEAST(1, (5000 - COALESCE(v_avg_response_ms, 5000)) / 4500.0)) * 20 +
    COALESCE(v_deploy_success::numeric / NULLIF(v_deploy_total, 0), 0) * 20 +
    COALESCE(v_compliance_pass::numeric / NULLIF(v_compliance_total, 0), 0) * 15 +
    LEAST(1, COALESCE(v_learning_count, 0) / 5.0) * 5
  );

  v_maturity_level := CASE
    WHEN v_maturity_score >= 80 THEN 'expert'
    WHEN v_maturity_score >= 60 THEN 'proficient'
    WHEN v_maturity_score >= 35 THEN 'intermediate'
    ELSE 'novice'
  END;

  RETURN jsonb_build_object(
    'story_id', p_story_id,
    'webhook_reliability', ROUND(COALESCE(v_webhook_success::numeric / NULLIF(v_webhook_total, 0), 0), 4),
    'webhook_events_count', v_webhook_total,
    'avg_response_time_ms', COALESCE(v_avg_response_ms, 0),
    'deployment_success_rate', ROUND(COALESCE(v_deploy_success::numeric / NULLIF(v_deploy_total, 0), 0), 4),
    'deployments_count', v_deploy_total,
    'compliance_pass_rate', ROUND(COALESCE(v_compliance_pass::numeric / NULLIF(v_compliance_total, 0), 0), 4),
    'learning_proposals_count', v_learning_count,
    'maturity_score', ROUND(v_maturity_score, 2),
    'maturity_level', v_maturity_level,
    'period_days', 30
  );
END;
$$;

REVOKE ALL ON FUNCTION public.get_story_aisha_maturity(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_story_aisha_maturity(uuid) TO authenticated;
