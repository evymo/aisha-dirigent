-- ============================================================================
-- Source of Truth: set_ai_budget_audited
-- Mission Control governance — upsert a scope's AI spend cap (admin/staff).
-- "You're the board — set the ceiling." NULL limit = that dimension uncapped.
-- Security: SECURITY DEFINER + is_admin_or_staff() guard + audit_journal.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.set_ai_budget_audited(
  p_scope_type     text,
  p_scope_id       uuid,
  p_token_limit    int DEFAULT NULL,
  p_cost_limit numeric DEFAULT NULL,
  p_period         text DEFAULT 'lifetime'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_row public.ai_budget%ROWTYPE;
BEGIN
  -- Authorization: admin or staff only.
  IF NOT public.is_admin_or_staff() THEN
    RAISE EXCEPTION 'Unauthorized: admin or staff required' USING ERRCODE = '42501';
  END IF;

  -- Validate inputs.
  IF p_scope_type IS NULL OR p_scope_type NOT IN ('story', 'partner', 'agent') THEN
    RAISE EXCEPTION 'Invalid scope_type: %', p_scope_type USING ERRCODE = '22023';
  END IF;
  IF p_scope_id IS NULL THEN
    RAISE EXCEPTION 'p_scope_id is required' USING ERRCODE = '22023';
  END IF;
  IF p_period IS NULL OR p_period NOT IN ('lifetime', 'daily', 'monthly') THEN
    RAISE EXCEPTION 'Invalid period: %', p_period USING ERRCODE = '22023';
  END IF;
  IF p_token_limit IS NOT NULL AND p_token_limit < 0 THEN
    RAISE EXCEPTION 'p_token_limit must be >= 0' USING ERRCODE = '22023';
  END IF;
  IF p_cost_limit IS NOT NULL AND p_cost_limit < 0 THEN
    RAISE EXCEPTION 'p_cost_limit must be >= 0' USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.ai_budget (
    scope_type, scope_id, period, token_limit, cost_limit, created_by
  ) VALUES (
    p_scope_type, p_scope_id, p_period, p_token_limit, p_cost_limit, auth.uid()
  )
  ON CONFLICT (scope_type, scope_id, period) DO UPDATE SET
    token_limit    = EXCLUDED.token_limit,
    cost_limit = EXCLUDED.cost_limit,
    updated_at     = now()
  -- Explicit column list (security gate: no SELECT */RETURNING * on real tables).
  -- Order matches public.ai_budget definition for %ROWTYPE compatibility.
  RETURNING id, scope_type, scope_id, period, token_limit, cost_limit,
            consumed_tokens, consumed_cost, last_reset_at,
            created_by, created_at, updated_at
  INTO v_row;

  -- Audit (mutation of a governance control — always logged, IDs + limits, no PII).
  INSERT INTO public.audit_journal (user_id, action, metadata)
  VALUES (
    auth.uid(),
    'ai.budget.set',
    jsonb_build_object(
      'scope_type',     p_scope_type,
      'scope_id',       p_scope_id,
      'period',         p_period,
      'token_limit',    p_token_limit,
      'cost_limit', p_cost_limit
    )
  );

  RETURN jsonb_build_object(
    'id',                v_row.id,
    'scope_type',        v_row.scope_type,
    'scope_id',          v_row.scope_id,
    'period',            v_row.period,
    'token_limit',       v_row.token_limit,
    'cost_limit',    v_row.cost_limit,
    'consumed_tokens',   v_row.consumed_tokens,
    'consumed_cost', v_row.consumed_cost
  );
END;
$$;

REVOKE ALL ON FUNCTION public.set_ai_budget_audited(text, uuid, int, numeric, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.set_ai_budget_audited(text, uuid, int, numeric, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.set_ai_budget_audited(text, uuid, int, numeric, text) TO service_role;
