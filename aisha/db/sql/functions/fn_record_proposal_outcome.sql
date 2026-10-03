-- Function: public.fn_record_proposal_outcome
-- Closes the self-improvement loop: measures whether an APPLIED improvement
-- proposal actually helped, by comparing the story's self-eval maturity score
-- before vs after the change.
--
-- Two-phase (auto-detected by presence of outcome.score_before), so a single
-- cron (WF_PROPOSAL_OUTCOME_REVIEW) can drive both:
--   Phase 1 (baseline): right after apply, snapshot score_before.
--   Phase 2 (outcome):  after p_window_hours, snapshot score_after + delta;
--                       on regression beyond threshold, PROPOSE a gated rollback.
--
-- ADVISORY-ONLY: never executes a rollback — only creates a 'rollback'-category
-- improvement_proposal via fn_create_improvement_proposal (which is itself gated:
-- risk eval + human approval). The loop proposes; humans/gates dispose.
--
-- @security: service_role (cron) or admin/staff.

CREATE OR REPLACE FUNCTION public.fn_record_proposal_outcome(
  p_proposal_id          uuid,
  p_regression_threshold numeric DEFAULT 5,
  p_window_hours         int     DEFAULT 24
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_is_service boolean := current_setting('role', true) = 'service_role';
  v_p          public.improvement_proposals;
  v_story_id   uuid;
  v_score_now  numeric;
  v_score_before numeric;
  v_delta      numeric;
  v_regressed  boolean;
  v_outcome    jsonb;
BEGIN
  IF NOT v_is_service AND NOT public.is_admin_or_staff() THEN
    RAISE EXCEPTION 'Unauthorized' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_p FROM public.improvement_proposals WHERE id = p_proposal_id;
  IF v_p IS NULL THEN
    RAISE EXCEPTION 'proposal % not found', p_proposal_id;
  END IF;
  IF v_p.status <> 'applied' THEN
    RETURN jsonb_build_object('proposal_id', p_proposal_id, 'skipped', 'not_applied', 'status', v_p.status);
  END IF;

  -- Resolve story scope: run_id → ai_runs.story_id, else metadata.story_id.
  v_story_id := COALESCE(
    (SELECT ar.story_id FROM public.ai_runs ar WHERE ar.id = v_p.run_id),
    NULLIF(v_p.metadata->>'story_id', '')::uuid
  );
  IF v_story_id IS NULL THEN
    v_outcome := COALESCE(v_p.outcome, '{}'::jsonb) || jsonb_build_object('error', 'no_story_scope', 'measured_at', now());
    UPDATE public.improvement_proposals SET outcome = v_outcome, updated_at = now() WHERE id = p_proposal_id;
    RETURN v_outcome || jsonb_build_object('proposal_id', p_proposal_id, 'phase', 'no_scope');
  END IF;

  v_score_now := (public.get_story_aisha_maturity(v_story_id)->>'maturity_score')::numeric;

  -- Phase 1 — baseline.
  IF (v_p.outcome->>'score_before') IS NULL THEN
    v_outcome := COALESCE(v_p.outcome, '{}'::jsonb) || jsonb_build_object(
      'story_id', v_story_id, 'score_before', v_score_now, 'baseline_at', now());
    UPDATE public.improvement_proposals SET outcome = v_outcome, updated_at = now() WHERE id = p_proposal_id;
    RETURN v_outcome || jsonb_build_object('proposal_id', p_proposal_id, 'phase', 'baseline');
  END IF;

  -- Phase 2 — outcome (delta vs baseline).
  v_score_before := (v_p.outcome->>'score_before')::numeric;
  v_delta := v_score_now - v_score_before;
  v_regressed := v_delta < -abs(p_regression_threshold);
  v_outcome := v_p.outcome || jsonb_build_object(
    'score_after', v_score_now, 'score_delta', round(v_delta, 2),
    'regressed', v_regressed, 'window_hours', p_window_hours, 'measured_at', now());
  UPDATE public.improvement_proposals SET outcome = v_outcome, updated_at = now() WHERE id = p_proposal_id;

  -- On regression: PROPOSE a gated rollback (advisory-only — never executes here).
  IF v_regressed THEN
    PERFORM public.fn_create_improvement_proposal(
      COALESCE(v_p.agent_slug, 'dirigent'),
      'rollback',
      format('Applied proposal %s regressed story self-eval score by %s (%s → %s). Consider rollback (gated).',
             p_proposal_id, round(v_delta, 2), v_score_before, v_score_now),
      jsonb_build_object(
        'anomaly_key', 'rollback:' || p_proposal_id::text,
        'story_id', v_story_id,
        'regressed_proposal_id', p_proposal_id,
        'score_delta', round(v_delta, 2),
        'source', 'fn_record_proposal_outcome'),
      format('Rollback regressed proposal %s', left(p_proposal_id::text, 8))
    );
  END IF;

  RETURN v_outcome || jsonb_build_object('proposal_id', p_proposal_id, 'phase', 'outcome');
END;
$$;

REVOKE ALL ON FUNCTION public.fn_record_proposal_outcome(uuid, numeric, int) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.fn_record_proposal_outcome(uuid, numeric, int) TO authenticated;
GRANT EXECUTE ON FUNCTION public.fn_record_proposal_outcome(uuid, numeric, int) TO service_role;
