-- ============================================================================
-- Source of Truth: list_ai_resolver_policies
-- Purpose: ResolverPolicyCard (admin) — every ai_resolver_policy row (incl. inactive) with all
--          tunable weights/thresholds/defaults, so the operator editor shows the live policy.
-- Security: SECURITY DEFINER, admin/staff read (clone of list_ai_spend_policies).
-- ============================================================================

CREATE OR REPLACE FUNCTION public.list_ai_resolver_policies()
RETURNS TABLE (
  policy_id                    uuid,
  scope_type                   text,
  scope_id                     uuid,
  task_kind                    text,
  bench_weight                 numeric,
  local_bonus                  numeric,
  cost_match_weight            numeric,
  tool_match_weight            numeric,
  vision_match_weight          numeric,
  budget_remaining_floor   numeric,
  budget_max_cost          numeric,
  premium_max_cost         numeric,
  batch_min_deadline_hours     integer,
  batch_min_tokens             integer,
  health_allow_set             text[],
  default_bench                numeric,
  default_expected_tokens      integer,
  default_deadline_hours       integer,
  default_max_cost         numeric,
  default_budget_remaining numeric,
  is_active                    boolean,
  updated_at                   timestamptz
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF NOT public.is_admin_or_staff() THEN
    RAISE EXCEPTION 'Unauthorized: admin or staff required' USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  SELECT
    rp.id AS policy_id,
    rp.scope_type, rp.scope_id, rp.task_kind,
    rp.bench_weight, rp.local_bonus, rp.cost_match_weight,
    rp.tool_match_weight, rp.vision_match_weight,
    rp.budget_remaining_floor, rp.budget_max_cost, rp.premium_max_cost,
    rp.batch_min_deadline_hours, rp.batch_min_tokens, rp.health_allow_set,
    rp.default_bench, rp.default_expected_tokens, rp.default_deadline_hours,
    rp.default_max_cost, rp.default_budget_remaining,
    rp.is_active, rp.updated_at
  FROM public.ai_resolver_policy rp
  ORDER BY rp.scope_type, rp.task_kind NULLS FIRST, rp.updated_at DESC;
END;
$$;

REVOKE ALL ON FUNCTION public.list_ai_resolver_policies() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.list_ai_resolver_policies() TO authenticated;
GRANT EXECUTE ON FUNCTION public.list_ai_resolver_policies() TO service_role;

COMMENT ON FUNCTION public.list_ai_resolver_policies() IS
  'All ai_resolver_policy rows (incl. inactive) with full weights/thresholds for the ResolverPolicyCard editor. Admin/staff only.';
