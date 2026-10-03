-- Function: fn_create_improvement_proposal
-- Creates an improvement proposal for an AISHA agent.
-- Includes anomaly_key dedup, rate limiting, automatic risk evaluation,
-- and auto-approve for low-risk proposals on fully autonomous agents.
-- Source: migration 20260418130000_fix_self_improvement_foundation.sql

CREATE OR REPLACE FUNCTION public.fn_create_improvement_proposal(
  p_agent_slug text,
  p_category text DEFAULT 'general',
  p_description text DEFAULT '',
  p_metadata jsonb DEFAULT '{}',
  p_title text DEFAULT ''
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_anomaly_key text;
  v_agent record;
  v_existing_id uuid;
  v_proposal_id uuid;
  v_recent_count int;
  v_risk text;
  v_run_id uuid;
BEGIN
  -- Stráž (2026-09-28, SELF_IMPROVEMENT_LOOP.md K-15): SECURITY DEFINER s grantem
  -- `authenticated` bez vlastní stráže = každý přihlášený zakládal návrhy zlepšení;
  -- u plně autonomního agenta s nízkým rizikem rovnou 'auto_approved' — vstup do
  -- smyčky sebezměny pro kohokoli. Volají ji jen služba (n8n, svc-agent-runner,
  -- fn_hermes_learning_loop, fn_record_proposal_outcome) a správcovské UI.
  IF NOT (public.is_service_role() OR public.is_admin_or_staff()) THEN
    RAISE EXCEPTION 'Unauthorized' USING ERRCODE = '42501';
  END IF;

  -- Validate agent exists in catalog
  SELECT slug, default_model, autonomy_level, safety_level
    INTO v_agent
    FROM agent_catalog
   WHERE slug = p_agent_slug;

  IF v_agent IS NULL THEN
    RAISE EXCEPTION 'Unknown agent: %', p_agent_slug;
  END IF;

  -- Extract anomaly_key from metadata (if provided by n8n workflow)
  v_anomaly_key := p_metadata ->> 'anomaly_key';

  -- Dedup: check if active proposal with same anomaly_key exists (7-day window)
  IF v_anomaly_key IS NOT NULL THEN
    SELECT ip.id INTO v_existing_id
      FROM improvement_proposals ip
     WHERE ip.anomaly_key = v_anomaly_key
       AND ip.status IN ('draft','pending','pending_review','approved','auto_approved','in_progress')
       AND ip.created_at >= now() - interval '7 days'
     LIMIT 1;

    IF v_existing_id IS NOT NULL THEN
      RETURN jsonb_build_object(
        'error', 'duplicate',
        'existing_proposal_id', v_existing_id,
        'message', format('Active proposal %s already exists for anomaly_key %s', v_existing_id, v_anomaly_key)
      );
    END IF;
  END IF;

  -- Rate limit: max 3 proposals per hour per agent
  SELECT count(*) INTO v_recent_count
    FROM improvement_proposals ip
   WHERE ip.agent_slug = p_agent_slug
     AND ip.created_at > now() - interval '1 hour';

  IF v_recent_count >= 3 THEN
    RETURN jsonb_build_object(
      'error', 'rate_limit',
      'message', format('Agent %s exceeded 3 proposals/hour', p_agent_slug)
    );
  END IF;

  -- Evaluate risk
  v_risk := fn_evaluate_proposal_risk(p_agent_slug, p_category, p_metadata);

  -- Create tracking ai_run
  v_run_id := gen_random_uuid();
  -- §16: platform/system run → platform sentinel story (ai_runs.story_id NOT NULL).
  INSERT INTO ai_runs (id, story_id, kind, metadata, route_plan, started_at, status)
  VALUES (
    v_run_id,
    public.ensure_stack_default_story(),
    'proactive',
    jsonb_build_object('model', v_agent.default_model, 'type', 'improvement_proposal'),
    jsonb_build_array(p_agent_slug),
    now(),
    'running'
  );

  -- Store current agent state for rollback capability
  v_proposal_id := gen_random_uuid();
  INSERT INTO improvement_proposals (
    id, agent_slug, anomaly_key, category, created_at,
    current_value, description, metadata,
    risk_level, run_id, status, title, updated_at
  ) VALUES (
    v_proposal_id, p_agent_slug, v_anomaly_key, p_category, now(),
    jsonb_build_object(
      'default_model', v_agent.default_model
    ),
    p_description, p_metadata,
    v_risk, v_run_id,
    CASE
      WHEN v_risk = 'low' AND v_agent.autonomy_level = 'full' THEN 'auto_approved'
      ELSE 'pending'
    END,
    p_title, now()
  );

  -- Log trace event
  INSERT INTO ai_trace_events (
    agent_slug, event_type, operation, request_summary,
    response_summary, run_id, status
  ) VALUES (
    p_agent_slug, 'improvement_proposal', 'create_proposal',
    jsonb_build_object('anomaly_key', v_anomaly_key, 'category', p_category, 'title', p_title),
    jsonb_build_object('proposal_id', v_proposal_id, 'risk', v_risk),
    v_run_id, 'ok'
  );

  -- Finish run
  UPDATE ai_runs SET finished_at = now(), status = 'succeeded' WHERE id = v_run_id;

  RETURN jsonb_build_object(
    'agent', p_agent_slug,
    'anomaly_key', v_anomaly_key,
    'proposal_id', v_proposal_id,
    'risk_level', v_risk,
    'run_id', v_run_id,
    'status', CASE
      WHEN v_risk = 'low' AND v_agent.autonomy_level = 'full' THEN 'auto_approved'
      ELSE 'pending'
    END
  );
END;
$$;

COMMENT ON FUNCTION fn_create_improvement_proposal(text, text, text, jsonb, text) IS
  'Create an improvement proposal for an AISHA agent. Includes anomaly_key dedup, '
  'rate limiting (3/hour/agent), automatic risk evaluation, and auto-approve for '
  'low-risk proposals on fully autonomous agents.';

REVOKE ALL ON FUNCTION fn_create_improvement_proposal(text, text, text, jsonb, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION fn_create_improvement_proposal(text, text, text, jsonb, text) TO authenticated;
GRANT EXECUTE ON FUNCTION fn_create_improvement_proposal(text, text, text, jsonb, text) TO service_role;
