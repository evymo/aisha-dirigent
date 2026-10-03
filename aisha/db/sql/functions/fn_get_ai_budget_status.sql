-- ============================================================================
-- Source of Truth: fn_get_ai_budget_status
-- Mission Control governance — read a scope's spend cap status (remaining + state).
-- Used by the admission gate (fn_create_workflow_run), the story-consult route,
-- and the board chip. NO write side-effect (STABLE) — period reset happens only
-- in the consume RPC.
-- Security: SECURITY DEFINER STABLE (read-only). Admin/staff OR story participant.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.fn_get_ai_budget_status(
  p_scope_type text,
  p_scope_id   uuid,
  p_period     text DEFAULT 'lifetime'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
STABLE
AS $$
DECLARE
  v_row   public.ai_budget%ROWTYPE;
  v_state text;
  v_pct   numeric := 0;
BEGIN
  -- Authorization: admin/staff see any scope; story participants see their story;
  -- service_role (autonomous control layer) always allowed.
  IF current_setting('role', true) <> 'service_role' AND NOT public.is_admin_or_staff() THEN
    IF NOT (
      p_scope_type = 'story' AND EXISTS (
        SELECT 1 FROM public.story_participants sp
        WHERE sp.story_id = p_scope_id AND sp.user_id = auth.uid()
      )
    ) THEN
      RAISE EXCEPTION 'Unauthorized' USING ERRCODE = '42501';
    END IF;
  END IF;

  -- Explicit column list (security gate: no SELECT * on real tables).
  -- Order matches public.ai_budget definition for %ROWTYPE compatibility.
  SELECT id, scope_type, scope_id, period, token_limit, cost_limit,
         consumed_tokens, consumed_cost, last_reset_at,
         created_by, created_at, updated_at
  INTO v_row
  FROM public.ai_budget
  WHERE scope_type = p_scope_type
    AND scope_id = p_scope_id
    AND period = p_period;

  -- No cap configured → unlimited (state ok).
  IF NOT FOUND THEN
    RETURN jsonb_build_object(
      'scope_type',         p_scope_type,
      'scope_id',           p_scope_id,
      'period',             p_period,
      'has_budget',         false,
      'token_limit',        NULL,
      'cost_limit',     NULL,
      'consumed_tokens',    0,
      'consumed_cost',  0,
      'remaining_tokens',   NULL,
      'remaining_cost', NULL,
      'state',              'ok'
    );
  END IF;

  -- State from the most-consumed limited dimension.
  IF v_row.cost_limit IS NOT NULL AND v_row.cost_limit > 0 THEN
    v_pct := GREATEST(v_pct, v_row.consumed_cost / v_row.cost_limit);
  END IF;
  IF v_row.token_limit IS NOT NULL AND v_row.token_limit > 0 THEN
    v_pct := GREATEST(v_pct, v_row.consumed_tokens::numeric / v_row.token_limit);
  END IF;

  v_state := CASE
    WHEN v_pct >= 1   THEN 'stopped'
    WHEN v_pct >= 0.8 THEN 'approaching'
    ELSE 'ok'
  END;

  RETURN jsonb_build_object(
    'scope_type',         v_row.scope_type,
    'scope_id',           v_row.scope_id,
    'period',             v_row.period,
    'has_budget',         true,
    'token_limit',        v_row.token_limit,
    'cost_limit',     v_row.cost_limit,
    'consumed_tokens',    v_row.consumed_tokens,
    'consumed_cost',  v_row.consumed_cost,
    'remaining_tokens',   CASE WHEN v_row.token_limit IS NULL THEN NULL
                               ELSE GREATEST(0, v_row.token_limit - v_row.consumed_tokens) END,
    'remaining_cost', CASE WHEN v_row.cost_limit IS NULL THEN NULL
                               ELSE GREATEST(0, v_row.cost_limit - v_row.consumed_cost) END,
    'state',              v_state
  );
END;
$$;

REVOKE ALL ON FUNCTION public.fn_get_ai_budget_status(text, uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.fn_get_ai_budget_status(text, uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.fn_get_ai_budget_status(text, uuid, text) TO service_role;
