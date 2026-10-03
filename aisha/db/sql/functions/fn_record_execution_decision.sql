-- ============================================================================
-- Source of Truth: fn_record_execution_decision  (E0 decision journal writer)
-- Purpose: THE only writer of ai_decisions. Persists one AishaExecutionDecision
--          (+ admission verdict) and returns its decision_id (the row id) so the
--          caller threads it onto ai_trace_events + every runtime adapter.
--          Structured columns are projected from the decision blob; the full
--          blob is stored for fidelity. VOLATILE wrapper around the STABLE
--          resolver/admission RPCs (which must never write).
-- Security: SECURITY DEFINER, VOLATILE. authenticated + service_role.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.fn_record_execution_decision(
  p_decision jsonb,
  p_run_id   uuid DEFAULT NULL,
  p_story_id uuid DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_id uuid;
BEGIN
  -- Fail-closed: NULL-safe role check. With absent/empty claims the role is NULL,
  -- and `NULL <> 'service_role'` is NULL (not TRUE) — which would let an
  -- unauthenticated caller through. IS DISTINCT FROM treats NULL as a value, so a
  -- caller with no auth.uid() and no service_role role is rejected. (Defense in
  -- depth behind the authenticated/service_role-only EXECUTE grant.)
  IF auth.uid() IS NULL
     AND (current_setting('request.jwt.claims', true)::jsonb->>'role') IS DISTINCT FROM 'service_role'
  THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '42501';
  END IF;

  IF p_decision IS NULL OR p_decision = '{}'::jsonb THEN
    RAISE EXCEPTION 'fn_record_execution_decision: p_decision required' USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.ai_decisions (
    run_id, story_id, clow_purpose,
    runtime, cli_slug,
    provider_slug, model_id, backend_kind, strategy,
    admission_verdict, risk_level, approval_required,
    resolution_source, reason, estimated_cost,
    resolver_policy_id,
    decision_json
  )
  VALUES (
    p_run_id,
    p_story_id,
    p_decision->>'clow_purpose',
    COALESCE(p_decision->>'runtime', 'direct_llm'),
    p_decision->>'cli_slug',
    p_decision->>'provider_slug',
    p_decision->>'model_id',
    p_decision->>'backend_kind',
    p_decision->>'strategy',
    p_decision->>'admission_verdict',
    p_decision->>'risk_level',
    COALESCE((p_decision->>'approval_required')::boolean, false),
    p_decision->>'resolution_source',
    p_decision->>'reason',
    NULLIF(p_decision->>'cost', '')::numeric,
    -- the active resolver policy that produced this decision (threaded from inputs.policy.id).
    NULLIF(COALESCE(p_decision->'policy'->>'id', p_decision->'inputs'->'policy'->>'id'), '')::uuid,
    p_decision
  )
  RETURNING id INTO v_id;

  -- Normalize the resolver's per-candidate ranking (already carried in the blob) into queryable
  -- rows so the admin drilldown can show WHY each candidate scored. Graceful: a decision with no
  -- candidate array (non-resolver path) inserts nothing.
  INSERT INTO public.ai_decision_candidates
    (decision_id, rank, is_top, provider_slug, model_id, backend_kind, score, reason)
  SELECT
    v_id,
    row_number() OVER (ORDER BY (c->>'score')::numeric DESC NULLS LAST)::int,
    (row_number() OVER (ORDER BY (c->>'score')::numeric DESC NULLS LAST) = 1),
    c->>'provider_slug', c->>'model_id', c->>'backend_kind',
    NULLIF(c->>'score', '')::numeric, c->>'reason'
  FROM jsonb_array_elements(
    CASE WHEN jsonb_typeof(p_decision->'candidates') = 'array'
         THEN p_decision->'candidates' ELSE '[]'::jsonb END) AS c;

  RETURN v_id;
END;
$$;

COMMENT ON FUNCTION public.fn_record_execution_decision(jsonb, uuid, uuid) IS
  'E0 decision journal writer (the only writer of ai_decisions). Persists an AishaExecutionDecision + verdict, returns decision_id. VOLATILE wrapper; resolver/admission RPCs stay STABLE.';

REVOKE ALL ON FUNCTION public.fn_record_execution_decision(jsonb, uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.fn_record_execution_decision(jsonb, uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.fn_record_execution_decision(jsonb, uuid, uuid) TO service_role;
