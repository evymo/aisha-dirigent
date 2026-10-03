-- Function: public.fn_get_decision_outcomes  (L0 feedback-plane outcome read)
-- Purpose: one row per execution DECISION (ai_decisions) joined to its execution
--   TRACE (ai_trace_events by decision_id) and the RUN (ai_runs) — "what did
--   decision D actually produce: runtime/model/backend, cost, latency, status,
--   eval — for real". This is the substrate the feedback plane (L1 rollup,
--   champion/challenger, proof harness) reads.
-- SINGLE-SoT: the outcome is DERIVED over the one decision journal (ai_decisions);
--   there is NO separate routing-outcomes table (guarded by no-second-routing-sot.gate).
-- Security: SECURITY DEFINER, STABLE. service_role (trusted backend) and admin/staff
--   see all; a user JWT must be a story_participants member of the run's story (or
--   the stack-default story). Platform/system runs (story_id IS NULL) are
--   service_role/admin-only. Mirrors the story_timeline auth pattern.

CREATE OR REPLACE FUNCTION public.fn_get_decision_outcomes(
  p_run_id uuid
)
RETURNS TABLE (
  decision_id        uuid,
  run_id             uuid,
  story_id           uuid,
  clow_purpose       text,
  runtime            text,
  model_id           text,
  backend_kind       text,
  strategy           text,
  admission_verdict  text,
  risk_level         text,
  resolution_source  text,
  estimated_cost numeric,
  exec_status        text,
  duration_ms        int,
  exec_cost      numeric,
  run_status         text,
  run_cost       numeric,
  eval_score         numeric,
  created_at         timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
STABLE
AS $$
DECLARE
  v_user_id    uuid    := auth.uid();
  -- Canonical boolean-NOT-NULL service check. The prior inline idiom folded to
  -- SQL NULL when the role claim was absent, and NULL propagated through the
  -- negative deny-guards below (IF NULL never RAISEs) → fail-OPEN. is_service_role()
  -- COALESCEs to false, so both guards are total and fail CLOSED. Same auth
  -- contract (service bypass preserved); only the NULL edge now denies.
  v_is_service boolean := public.is_service_role();
  v_is_admin   boolean := false;
  v_story_id   uuid;
BEGIN
  IF v_user_id IS NULL AND NOT v_is_service THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '42501';
  END IF;

  SELECT ar.story_id INTO v_story_id FROM public.ai_runs ar WHERE ar.id = p_run_id;

  v_is_admin := public.is_admin_or_staff(v_user_id);

  -- Authorization: trusted backend (service_role) OR admin/staff OR a participant
  -- of the run's story OR the stack-default story. A run with no story (platform/
  -- system) is service_role/admin-only.
  IF NOT v_is_service
     AND NOT v_is_admin
     AND NOT (
       v_story_id IS NOT NULL
       AND EXISTS (
         SELECT 1 FROM public.partner_stories ps
         WHERE ps.id = v_story_id
           AND (
             ps.is_stack_default = true
             OR EXISTS (
               SELECT 1 FROM public.story_participants sp
               WHERE sp.story_id = ps.id AND sp.user_id = v_user_id
             )
           )
       )
     )
  THEN
    RAISE EXCEPTION 'Access denied: story participant or admin/staff required'
      USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  SELECT
    d.id                                                    AS decision_id,
    d.run_id,
    d.story_id,
    d.clow_purpose,
    d.runtime,
    d.model_id,
    d.backend_kind,
    d.strategy,
    d.admission_verdict,
    d.risk_level,
    d.resolution_source,
    d.estimated_cost,
    t.status                                                AS exec_status,
    t.duration_ms,
    NULLIF(t.cost_json ->> 'total', '')::numeric        AS exec_cost,
    r.status                                                AS run_status,
    NULLIF(r.cost_total_json ->> 'total', '')::numeric  AS run_cost,
    r.faithfulness_score_estimate                           AS eval_score,
    d.created_at
  FROM public.ai_decisions d
  LEFT JOIN public.ai_trace_events t
    ON t.decision_id = d.id
   AND t.event_type IN ('llm_call', 'tool_call')
  LEFT JOIN public.ai_runs r ON r.id = d.run_id
  WHERE d.run_id = p_run_id
  ORDER BY d.created_at ASC;
END;
$$;

COMMENT ON FUNCTION public.fn_get_decision_outcomes(uuid) IS
  'L0 feedback-plane outcome read: ai_decisions join ai_trace_events (by decision_id) join ai_runs for one run. Derived over the single decision journal (no separate routing-outcomes table). SECURITY DEFINER + STABLE; service_role/admin or run-story participant.';

REVOKE ALL ON FUNCTION public.fn_get_decision_outcomes(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.fn_get_decision_outcomes(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.fn_get_decision_outcomes(uuid) TO service_role;
