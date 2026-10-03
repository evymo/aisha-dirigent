-- ============================================================================
-- Source of Truth: get_ai_decisions_admin
-- Purpose: The operator's decision-observability read. One row per AISHA execution decision with
--          its full per-candidate ranking (the resolver score breakdown), the active resolver
--          policy that produced it, and estimated-vs-actual cost — so an admin can SEE the decision
--          flow + the reasoning + the cost in one query (the visibility half of the operator-
--          control program). Admin/staff only (clone of get_ai_trace_events_admin).
-- ============================================================================

CREATE OR REPLACE FUNCTION public.get_ai_decisions_admin(
  p_limit    integer DEFAULT 50,
  p_story_id uuid    DEFAULT NULL
)
RETURNS TABLE (
  decision_id        uuid,
  created_at         timestamptz,
  clow_purpose       text,
  runtime            text,
  provider_slug      text,
  model_id           text,
  backend_kind       text,
  strategy           text,
  resolution_source  text,
  admission_verdict  text,
  reason             text,
  resolver_policy_id uuid,
  estimated_cost numeric,
  actual_cost    numeric,
  candidates         jsonb
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF NOT public.is_admin_or_staff() THEN
    RAISE EXCEPTION 'Permission denied' USING ERRCODE = 'P0003';
  END IF;

  RETURN QUERY
  SELECT
    d.id, d.created_at, d.clow_purpose,
    d.runtime, d.provider_slug, d.model_id, d.backend_kind, d.strategy,
    d.resolution_source, d.admission_verdict, d.reason,
    d.resolver_policy_id,
    d.estimated_cost,
    -- Actual post-paid spend = SUM of the trace events that carry this decision_id (the est-vs-
    -- actual chip the operator compares against; NULL until dispatch trace lands).
    (SELECT SUM((ate.cost_json->>'usd')::numeric)
       FROM public.ai_trace_events ate WHERE ate.decision_id = d.id) AS actual_cost,
    -- The ranked candidates (the resolver's transparent score breakdown — WHY this winner).
    COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
               'rank', c.rank, 'is_top', c.is_top,
               'provider_slug', c.provider_slug, 'model_id', c.model_id,
               'backend_kind', c.backend_kind, 'score', c.score, 'reason', c.reason
             ) ORDER BY c.rank)
        FROM public.ai_decision_candidates c WHERE c.decision_id = d.id
    ), '[]'::jsonb) AS candidates
  FROM public.ai_decisions d
  WHERE (p_story_id IS NULL OR d.story_id = p_story_id)
  ORDER BY d.created_at DESC
  LIMIT GREATEST(1, LEAST(COALESCE(p_limit, 50), 200));
END;
$$;

REVOKE ALL ON FUNCTION public.get_ai_decisions_admin(integer, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_ai_decisions_admin(integer, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_ai_decisions_admin(integer, uuid) TO service_role;

COMMENT ON FUNCTION public.get_ai_decisions_admin(integer, uuid) IS
  'Operator decision-observability read: each ai_decisions row + its candidate ranking + active resolver policy + estimated-vs-actual cost. Admin/staff only.';
