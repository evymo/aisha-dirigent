-- Function: public.fn_hermes_learning_loop
-- Hermes reflexive-learning loop (E3) — the "Hermes learns" leg, automated.
--
-- On story closure it (1) runs the advisory self-evaluation (evaluate_story_self,
-- which also refreshes story_goal_state — E15), then for ACTIONABLE findings it
-- (2) captures a hippocampus learning and (3) synthesizes one improvement_proposal
-- per finding through fn_create_improvement_proposal.
--
-- AGGRESSIVE but governed, NOT an allow-list: fn_create_improvement_proposal itself
-- risk-evaluates (fn_evaluate_proposal_risk → low|medium|high|critical|manual),
-- rate-limits (3/agent/hour), dedups by anomaly_key, and AUTO-APPROVES only low-risk
-- proposals on fully-autonomous agents — everything else stays pending for the human
-- gate. So "how aggressive" is decided by computed risk + the agent's autonomy level,
-- never a roster of permitted actions. evaluate_story_self stays advisory-only; this
-- driver is the separate, gated action step it explicitly defers to.
--
-- Security: SECURITY DEFINER, service_role + authenticated.

CREATE OR REPLACE FUNCTION public.fn_hermes_learning_loop(
  p_story_id  uuid,
  p_run_id    uuid DEFAULT NULL,
  p_backend   text DEFAULT NULL,
  p_agent_slug text DEFAULT 'aisha'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_user_id     uuid := auth.uid();
  v_is_service  boolean := current_setting('role', true) = 'service_role';
  v_eval        jsonb;
  v_findings    jsonb;
  v_finding     jsonb;
  v_learning_id uuid;
  v_proposals   jsonb := '[]'::jsonb;
  v_proposal    jsonb;
  v_score       numeric;
  v_level       text;
BEGIN
  -- Auth gate (mirrors evaluate_story_self): service_role is the trusted system
  -- caller (svc-agent-runner) without a user JWT; any other caller needs auth.uid().
  IF v_user_id IS NULL AND NOT v_is_service THEN
    RAISE EXCEPTION 'Unauthorized: not authenticated' USING ERRCODE = '22023';
  END IF;

  -- 1. Advisory evaluation (also refreshes story_goal_state — E15).
  v_eval := evaluate_story_self(p_story_id, p_backend);
  v_findings := COALESCE(v_eval -> 'findings', '[]'::jsonb);
  v_score := COALESCE((v_eval ->> 'score')::numeric, 0);
  v_level := COALESCE(v_eval ->> 'level', 'novice');

  -- No actionable findings → advisory-only; nothing to learn or propose.
  IF jsonb_array_length(v_findings) = 0 THEN
    RETURN jsonb_build_object(
      'eval', v_eval, 'learning_id', NULL, 'proposals', v_proposals, 'actioned', false);
  END IF;

  -- 2. Capture the hippocampus learning (needs a run_id to anchor the reflection).
  IF p_run_id IS NOT NULL THEN
    v_learning_id := fn_capture_learning(
      p_run_id := p_run_id,
      p_pattern := format('story %s at maturity %s (score %s): %s open finding(s)',
                          p_story_id, v_level, v_score, jsonb_array_length(v_findings)),
      p_resolution := COALESCE(
        v_eval -> 'recommended_actions' -> 0 ->> 'rationale',
        'review open findings; consider a gated improvement_proposal'),
      p_critic_scores := jsonb_build_object('score', v_score, 'level', v_level),
      p_story_id := p_story_id,
      p_agent_slug := p_agent_slug,
      p_importance := CASE WHEN v_findings @> '[{"severity":"high"}]'::jsonb THEN 7 ELSE 5 END
    );
  END IF;

  -- 3. Aggressive synthesis: one improvement_proposal per finding. The RPC itself
  --    risk-evaluates + rate-limits + dedups + auto-approves low-risk-on-autonomous.
  FOR v_finding IN SELECT * FROM jsonb_array_elements(v_findings)
  LOOP
    BEGIN
      v_proposal := fn_create_improvement_proposal(
        p_agent_slug := p_agent_slug,
        p_category := COALESCE(v_finding ->> 'kind', 'general'),
        p_description := COALESCE(v_finding ->> 'summary', ''),
        p_metadata := jsonb_build_object(
          'story_id', p_story_id,
          'severity', v_finding ->> 'severity',
          'kind', v_finding ->> 'kind',
          'maturity_level', v_level,
          'score', v_score,
          'anomaly_key', format('hermes:%s:%s', p_story_id, v_finding ->> 'kind'),
          'source', 'hermes_learning_loop'
        ),
        p_title := left(format('Hermes: %s', COALESCE(v_finding ->> 'summary', v_finding ->> 'kind')), 200)
      );
      v_proposals := v_proposals || v_proposal;
    EXCEPTION WHEN OTHERS THEN
      -- rate-limit / dedup / unknown-agent → record + continue (advisory: never brick).
      v_proposals := v_proposals || jsonb_build_object(
        'skipped', true, 'kind', v_finding ->> 'kind', 'reason', SQLERRM);
    END;
  END LOOP;

  RETURN jsonb_build_object(
    'eval', v_eval, 'learning_id', v_learning_id, 'proposals', v_proposals, 'actioned', true);
END;
$$;

-- service_role only: this is a system-triggered orchestration step (svc-agent-runner
-- on story closure), not a user-callable RPC. Restricting to service_role keeps it a
-- least-privilege SECURITY DEFINER function whose access IS its auth gate (no broad
-- 'authenticated' grant that would demand an in-body auth check).
REVOKE ALL ON FUNCTION public.fn_hermes_learning_loop(uuid, uuid, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.fn_hermes_learning_loop(uuid, uuid, text, text) TO service_role;
