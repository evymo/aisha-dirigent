-- ============================================================================
-- Source of Truth: set_ai_resolver_policy_audited
-- Purpose: Upsert one ai_resolver_policy row (operator tuning of the orchestration-decision
--          weights/thresholds). NULL params INHERIT — from the existing row on update, or from
--          the always-present GLOBAL row when authoring a new scoped row — so a partial edit
--          never violates the NOT NULL columns and never silently zeroes a weight. Passing
--          p_deactivate=true retires the row (is_active=false); the GLOBAL row should not be
--          deactivated (the resolver fails loud without it).
-- Security: SECURITY DEFINER + is_admin_or_staff() guard + audit_journal (clone of
--           set_ai_spend_policy_audited).
-- ============================================================================

CREATE OR REPLACE FUNCTION public.set_ai_resolver_policy_audited(
  p_scope_type                   text    DEFAULT 'global',
  p_scope_id                     uuid    DEFAULT NULL,
  p_task_kind                    text    DEFAULT NULL,
  p_bench_weight                 numeric DEFAULT NULL,
  p_local_bonus                  numeric DEFAULT NULL,
  p_cost_match_weight            numeric DEFAULT NULL,
  p_tool_match_weight            numeric DEFAULT NULL,
  p_vision_match_weight          numeric DEFAULT NULL,
  p_budget_remaining_floor   numeric DEFAULT NULL,
  p_budget_max_cost          numeric DEFAULT NULL,
  p_premium_max_cost         numeric DEFAULT NULL,
  p_batch_min_deadline_hours     integer DEFAULT NULL,
  p_batch_min_tokens             integer DEFAULT NULL,
  p_health_allow_set             text[]  DEFAULT NULL,
  p_default_bench                numeric DEFAULT NULL,
  p_default_expected_tokens      integer DEFAULT NULL,
  p_default_deadline_hours       integer DEFAULT NULL,
  p_default_max_cost         numeric DEFAULT NULL,
  p_default_budget_remaining numeric DEFAULT NULL,
  p_deactivate                   boolean DEFAULT false
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_task_kind text := NULLIF(btrim(COALESCE(p_task_kind, '')), '');
  v_base public.ai_resolver_policy%ROWTYPE;
  v_row  public.ai_resolver_policy%ROWTYPE;
BEGIN
  IF NOT public.is_admin_or_staff() THEN
    RAISE EXCEPTION 'Unauthorized: admin or staff required' USING ERRCODE = '42501';
  END IF;

  -- JIT-provision the admin actor so the audit_journal insert can't FK-violate (23503).
  PERFORM public.ensure_current_user();

  IF p_scope_type NOT IN ('global', 'story', 'instance') THEN
    RAISE EXCEPTION 'Invalid scope_type: %', p_scope_type USING ERRCODE = '22023';
  END IF;
  IF (p_scope_type = 'global') <> (p_scope_id IS NULL) THEN
    RAISE EXCEPTION 'scope_id must be NULL for global scope and set otherwise' USING ERRCODE = '22023';
  END IF;

  -- Inherit base: the existing row for this exact scope (partial update), else the GLOBAL row
  -- (authoring a new scoped row inherits the platform default). The GLOBAL row always exists.
  SELECT * INTO v_base FROM public.ai_resolver_policy
   WHERE scope_type = p_scope_type
     AND scope_id IS NOT DISTINCT FROM p_scope_id
     AND task_kind IS NOT DISTINCT FROM v_task_kind;
  IF NOT FOUND THEN
    SELECT * INTO v_base FROM public.ai_resolver_policy
     WHERE scope_type = 'global' AND task_kind IS NULL;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'ai_resolver_policy GLOBAL row missing — cannot author a policy without a base'
        USING ERRCODE = 'P0001';
    END IF;
  END IF;

  INSERT INTO public.ai_resolver_policy (
    scope_type, scope_id, task_kind,
    bench_weight, local_bonus, cost_match_weight, tool_match_weight, vision_match_weight,
    budget_remaining_floor, budget_max_cost, premium_max_cost,
    batch_min_deadline_hours, batch_min_tokens, health_allow_set,
    default_bench, default_expected_tokens, default_deadline_hours,
    default_max_cost, default_budget_remaining,
    is_active, created_by
  ) VALUES (
    p_scope_type, p_scope_id, v_task_kind,
    COALESCE(p_bench_weight, v_base.bench_weight),
    COALESCE(p_local_bonus, v_base.local_bonus),
    COALESCE(p_cost_match_weight, v_base.cost_match_weight),
    COALESCE(p_tool_match_weight, v_base.tool_match_weight),
    COALESCE(p_vision_match_weight, v_base.vision_match_weight),
    COALESCE(p_budget_remaining_floor, v_base.budget_remaining_floor),
    COALESCE(p_budget_max_cost, v_base.budget_max_cost),
    COALESCE(p_premium_max_cost, v_base.premium_max_cost),
    COALESCE(p_batch_min_deadline_hours, v_base.batch_min_deadline_hours),
    COALESCE(p_batch_min_tokens, v_base.batch_min_tokens),
    COALESCE(p_health_allow_set, v_base.health_allow_set),
    COALESCE(p_default_bench, v_base.default_bench),
    COALESCE(p_default_expected_tokens, v_base.default_expected_tokens),
    COALESCE(p_default_deadline_hours, v_base.default_deadline_hours),
    COALESCE(p_default_max_cost, v_base.default_max_cost),
    COALESCE(p_default_budget_remaining, v_base.default_budget_remaining),
    NOT COALESCE(p_deactivate, false), auth.uid()
  )
  ON CONFLICT ON CONSTRAINT ai_resolver_policy_scope_kind_uniq DO UPDATE SET
    bench_weight                 = COALESCE(p_bench_weight, v_base.bench_weight),
    local_bonus                  = COALESCE(p_local_bonus, v_base.local_bonus),
    cost_match_weight            = COALESCE(p_cost_match_weight, v_base.cost_match_weight),
    tool_match_weight            = COALESCE(p_tool_match_weight, v_base.tool_match_weight),
    vision_match_weight          = COALESCE(p_vision_match_weight, v_base.vision_match_weight),
    budget_remaining_floor   = COALESCE(p_budget_remaining_floor, v_base.budget_remaining_floor),
    budget_max_cost          = COALESCE(p_budget_max_cost, v_base.budget_max_cost),
    premium_max_cost         = COALESCE(p_premium_max_cost, v_base.premium_max_cost),
    batch_min_deadline_hours     = COALESCE(p_batch_min_deadline_hours, v_base.batch_min_deadline_hours),
    batch_min_tokens             = COALESCE(p_batch_min_tokens, v_base.batch_min_tokens),
    health_allow_set             = COALESCE(p_health_allow_set, v_base.health_allow_set),
    default_bench                = COALESCE(p_default_bench, v_base.default_bench),
    default_expected_tokens      = COALESCE(p_default_expected_tokens, v_base.default_expected_tokens),
    default_deadline_hours       = COALESCE(p_default_deadline_hours, v_base.default_deadline_hours),
    default_max_cost         = COALESCE(p_default_max_cost, v_base.default_max_cost),
    default_budget_remaining = COALESCE(p_default_budget_remaining, v_base.default_budget_remaining),
    is_active                    = NOT COALESCE(p_deactivate, false),
    updated_at                   = now()
  RETURNING * INTO v_row;

  INSERT INTO public.audit_journal (user_id, action, metadata)
  VALUES (
    auth.uid(),
    'ai.resolver_policy.set',
    jsonb_strip_nulls(jsonb_build_object(
      'policy_id', v_row.id,
      'scope_type', v_row.scope_type,
      'scope_id', v_row.scope_id,
      'task_kind', v_row.task_kind,
      'bench_weight', v_row.bench_weight,
      'local_bonus', v_row.local_bonus,
      'cost_match_weight', v_row.cost_match_weight,
      'tool_match_weight', v_row.tool_match_weight,
      'vision_match_weight', v_row.vision_match_weight,
      'budget_max_cost', v_row.budget_max_cost,
      'premium_max_cost', v_row.premium_max_cost,
      'is_active', v_row.is_active
    ))
  );

  RETURN jsonb_build_object(
    'success', true,
    'policy_id', v_row.id,
    'is_active', v_row.is_active,
    'updated_at', v_row.updated_at
  );
END;
$$;

REVOKE ALL ON FUNCTION public.set_ai_resolver_policy_audited(text, uuid, text, numeric, numeric, numeric, numeric, numeric, numeric, numeric, numeric, integer, integer, text[], numeric, integer, integer, numeric, numeric, boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.set_ai_resolver_policy_audited(text, uuid, text, numeric, numeric, numeric, numeric, numeric, numeric, numeric, numeric, integer, integer, text[], numeric, integer, integer, numeric, numeric, boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.set_ai_resolver_policy_audited(text, uuid, text, numeric, numeric, numeric, numeric, numeric, numeric, numeric, numeric, integer, integer, text[], numeric, integer, integer, numeric, numeric, boolean) TO service_role;

COMMENT ON FUNCTION public.set_ai_resolver_policy_audited(text, uuid, text, numeric, numeric, numeric, numeric, numeric, numeric, numeric, numeric, integer, integer, text[], numeric, integer, integer, numeric, numeric, boolean) IS
  'Upsert one ai_resolver_policy row (operator tuning of resolver weights/thresholds). NULL params inherit from the existing row or the GLOBAL base. Admin/staff, audited.';
