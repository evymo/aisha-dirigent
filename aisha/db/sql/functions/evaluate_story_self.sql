-- Function: public.evaluate_story_self
-- Self-evaluation LENS — jednotný per-story verdikt. NE bespoke subsystém:
-- slévá get_story_aisha_maturity() (skóre + level) se selfeval_story_verdict_v
-- (faithfulness / drift / incidents / goal / proposals dimenze) do akceschopného
-- verdiktu. "Evaluation je perspektiva, ne entita" — vzor audience modul.
--
-- ADVISORY-ONLY: STABLE, read-only — NIKDY nemutuje stav. recommended_actions je
-- jen text; vznik ai_task / improvement_proposal / rollback jsou separátní gated
-- kroky (PR 4/5), ne tady.
--
-- GENERIC přes (story, backend): p_backend NULL = origin instance. PR 8 napojí
-- resolver přes story_instances / instance_endpoint_bindings; zatím echo do výstupu.
--
-- @security: authenticated (admin/staff/participant/stack-default — stejný P7 RLS
-- kontrakt jako fn_list_story_faithfulness_trend) + service_role (n8n/workflow).

CREATE OR REPLACE FUNCTION public.evaluate_story_self(
  p_story_id uuid,
  p_backend  text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_user_id    uuid := auth.uid();
  v_is_service boolean := current_setting('role', true) = 'service_role';
  v_maturity   jsonb;
  v_score      numeric;
  v_level      text;
  -- Dimensions read from selfeval_story_verdict_v via explicit-column SELECT.
  -- NOT %ROWTYPE: that would be a compile-time dependency on the view, and the
  -- generated baseline emits functions before views — so %ROWTYPE breaks cold-start.
  v_faithfulness_avg      numeric;
  v_faithfulness_n        integer;
  v_open_drift_count      integer;
  v_open_drift_high       integer;
  v_sentry_fatal_30d      integer;
  v_acceptance_criteria   jsonb;
  v_loop_iterations       integer;
  v_loop_max              integer;
  v_open_proposals        integer;
  v_applied_proposals_30d integer;
  v_dimensions jsonb;
  v_findings   jsonb := '[]'::jsonb;
  v_actions    jsonb := '[]'::jsonb;
BEGIN
  -- service_role (n8n/workflow) is a trusted system caller without a JWT;
  -- authenticated users must have auth.uid(). Bypass auth + gate for service_role.
  IF v_user_id IS NULL AND NOT v_is_service THEN
    RAISE EXCEPTION 'Unauthorized: not authenticated' USING ERRCODE = '22023';
  END IF;
  IF p_story_id IS NULL THEN
    RAISE EXCEPTION 'p_story_id is required' USING ERRCODE = '22023';
  END IF;

  -- Visibility: admin/staff sees all, participants see own stories, stack-default
  -- story is visible to all authenticated users (reuse P7 contract). service_role
  -- (trusted system caller) bypasses the participant gate.
  IF NOT v_is_service
     AND NOT public.is_admin_or_staff(v_user_id)
     AND NOT public.is_story_participant(v_user_id, p_story_id)
     AND NOT EXISTS (
       SELECT 1 FROM public.partner_stories
       WHERE id = p_story_id AND is_stack_default = true
     ) THEN
    RAISE EXCEPTION 'Forbidden: not a participant of story %', p_story_id
      USING ERRCODE = '42501';
  END IF;

  -- Reuse maturity (score + level) — fix-at-source, ne re-implement.
  v_maturity := public.get_story_aisha_maturity(p_story_id);
  v_score := COALESCE((v_maturity->>'maturity_score')::numeric, 0);
  v_level := COALESCE(v_maturity->>'maturity_level', 'novice');

  -- Reused operational dimensions from the lens view.
  SELECT faithfulness_avg, faithfulness_n, open_drift_count, open_drift_high,
         sentry_fatal_30d, acceptance_criteria, loop_iterations, loop_max,
         open_proposals, applied_proposals_30d
    INTO v_faithfulness_avg, v_faithfulness_n, v_open_drift_count, v_open_drift_high,
         v_sentry_fatal_30d, v_acceptance_criteria, v_loop_iterations, v_loop_max,
         v_open_proposals, v_applied_proposals_30d
    FROM public.selfeval_story_verdict_v WHERE story_id = p_story_id;

  v_dimensions := jsonb_build_array(
    jsonb_build_object('key', 'maturity', 'score', v_score, 'weight', 1.0, 'evidence', v_maturity),
    jsonb_build_object('key', 'faithfulness',
      'score', COALESCE(v_faithfulness_avg, 0),
      'evidence', jsonb_build_object('avg', v_faithfulness_avg, 'n', COALESCE(v_faithfulness_n, 0))),
    jsonb_build_object('key', 'drift',
      'evidence', jsonb_build_object('open', COALESCE(v_open_drift_count, 0), 'high', COALESCE(v_open_drift_high, 0))),
    jsonb_build_object('key', 'incidents',
      'evidence', jsonb_build_object('sentry_fatal_30d', COALESCE(v_sentry_fatal_30d, 0))),
    jsonb_build_object('key', 'goal',
      'evidence', jsonb_build_object(
        'loop_iterations', v_loop_iterations,
        'loop_max', v_loop_max,
        'acceptance_criteria', v_acceptance_criteria))
  );

  -- Findings (advisory only — derived, NOT actioned here).
  IF COALESCE(v_open_drift_high, 0) > 0 THEN
    v_findings := v_findings || jsonb_build_object(
      'severity', 'high', 'kind', 'drift',
      'summary', v_open_drift_high || ' high/critical drift open on story apps');
  END IF;
  IF COALESCE(v_sentry_fatal_30d, 0) > 0 THEN
    v_findings := v_findings || jsonb_build_object(
      'severity', 'high', 'kind', 'incident',
      'summary', v_sentry_fatal_30d || ' fatal Sentry events (30d) on story apps');
  END IF;
  IF v_loop_iterations IS NOT NULL AND v_loop_max IS NOT NULL
     AND v_loop_iterations >= v_loop_max THEN
    v_findings := v_findings || jsonb_build_object(
      'severity', 'medium', 'kind', 'goal',
      'summary', 'autonomous loop reached cap — review acceptance criteria');
  END IF;

  -- Recommended actions (advisory text — NIKDY se neaplikují odsud).
  IF jsonb_array_length(v_findings) > 0 THEN
    v_actions := v_actions || jsonb_build_object(
      'kind', 'review', 'target', 'operator',
      'rationale', 'open findings present — consider improvement_proposal / rollback (gated, advisory-only)');
  END IF;

  RETURN jsonb_build_object(
    'story_id', p_story_id,
    'backend', COALESCE(p_backend, 'origin'),
    'evaluated_at', now(),
    'period_days', 30,
    'score', v_score,
    'level', v_level,
    'dimensions', v_dimensions,
    'findings', v_findings,
    'recommended_actions', v_actions,
    'open_proposals', COALESCE(v_open_proposals, 0),
    'applied_proposals_30d', COALESCE(v_applied_proposals_30d, 0)
  );
END;
$$;

-- Permissions per CLAUDE.md SECURITY DEFINER pattern.
REVOKE ALL ON FUNCTION public.evaluate_story_self(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.evaluate_story_self(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.evaluate_story_self(uuid, text) TO service_role;
