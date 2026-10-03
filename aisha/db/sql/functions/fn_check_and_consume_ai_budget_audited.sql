-- ============================================================================
-- Source of Truth: fn_check_and_consume_ai_budget_audited
-- Mission Control governance — story-aware spend gate, called at the orchestration
-- control layer (reflection node boundary) with a node's ACTUAL token+USD cost.
--
-- Composition (NOT a parallel mechanism):
--   1. Per-user daily quota — reuse fn_check_and_consume_llm_quota_audited
--      (it consumes + audits its own denial).
--   2. Per-story budget — post-paid metering: record the actual spend against the
--      story's ai_budget row(s) (lifetime/daily/monthly), then signal halt when a
--      cap is reached. A completed LLM call cannot be un-spent, so we meter actuals
--      and stop the NEXT node — accepting a single last-node overshoot.
--   p_story_id NULL or no row → unlimited story side (backward compatible).
--
-- Returns: { allowed, reason ('ok'|'user_quota'|'story_budget'), user_quota, story_state }.
-- Security: SECURITY DEFINER. Audits the story-budget denial (user denial is
-- audited by the per-user RPC). No PII — IDs + numerics only.
-- ============================================================================

-- p_cost_usd → p_cost (currency literals removed from the schema). The type
-- signature did not change, so CREATE OR REPLACE matches the existing function
-- and Postgres refuses: "cannot change name of input parameter". DROP-first is
-- the convention used elsewhere in this directory; the REVOKE/GRANT below
-- re-applies the privileges the drop clears.
DROP FUNCTION IF EXISTS public.fn_check_and_consume_ai_budget_audited(uuid, uuid, int, numeric);

CREATE OR REPLACE FUNCTION public.fn_check_and_consume_ai_budget_audited(
  p_user_id  uuid,
  p_story_id uuid,
  p_tokens   int,
  p_cost numeric
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_user_result   jsonb;
  v_user_allowed  boolean := true;
  v_story_allowed boolean := true;
  v_reason        text := 'ok';
  v_row           public.ai_budget%ROWTYPE;
BEGIN
  -- AUTHORIZATION FIRST. The old guard had two defects (2026-07-15 IDOR audit,
  -- docs/security/IDOR_P_USER_ID_AUDIT_2026-07-15.md):
  --
  --  (a) It asked only "is SOMEONE authenticated?", never whether p_user_id was them or
  --      whether they had any claim on p_story_id. With the `authenticated` GRANT, a
  --      logged-in user could meter spend against ANY user's quota and ANY story's budget —
  --      exhausting a story they cannot even read, which halts its runs (`story_budget`).
  --  (b) It read the role GUC directly. NOT a fail-open — an earlier version of the audit claimed
  --      `current_setting('role', true) <> 'service_role'` folds to NULL, and that is FALSE:
  --      `role` is a BUILT-IN GUC and returns 'none', never NULL. Only DOTTED custom GUCs
  --      (request.jwt.claims) fold to NULL. is_service_role() is used because it is the canonical
  --      reader, not because the old expression was unsafe.
  --
  -- The p_user_id and p_story_id checks are the fix.
  IF NOT public.is_service_role() AND NOT public.is_admin_or_staff() THEN
    IF auth.uid() IS NULL OR p_user_id IS DISTINCT FROM auth.uid() THEN
      RAISE EXCEPTION 'Unauthorized' USING ERRCODE = '42501';
    END IF;
    IF p_story_id IS NOT NULL AND NOT public.is_story_participant(auth.uid(), p_story_id) THEN
      RAISE EXCEPTION 'Unauthorized: not a story participant' USING ERRCODE = '42501';
    END IF;
  END IF;

  -- Validate inputs.
  IF p_user_id IS NULL THEN
    RAISE EXCEPTION 'p_user_id is required' USING ERRCODE = '22023';
  END IF;
  IF p_tokens IS NULL OR p_tokens < 0 THEN
    RAISE EXCEPTION 'p_tokens must be >= 0' USING ERRCODE = '22023';
  END IF;
  IF p_cost IS NULL OR p_cost < 0 THEN
    RAISE EXCEPTION 'p_cost must be >= 0' USING ERRCODE = '22023';
  END IF;

  -- 1) Per-user daily quota (reuse the existing audited gate — consumes + audits).
  v_user_result := public.fn_check_and_consume_llm_quota_audited(p_user_id, p_tokens, p_cost);
  v_user_allowed := COALESCE((v_user_result ->> 'allowed')::boolean, true);
  IF NOT v_user_allowed THEN
    v_reason := 'user_quota';
  END IF;

  -- 2) Per-story budget — meter actuals across the story's period rows.
  IF p_story_id IS NOT NULL THEN
    FOR v_row IN
      -- Explicit column list (security gate: no SELECT * on real tables).
      -- Order matches public.ai_budget definition for %ROWTYPE compatibility.
      SELECT id, scope_type, scope_id, period, token_limit, cost_limit,
             consumed_tokens, consumed_cost, last_reset_at,
             created_by, created_at, updated_at
      FROM public.ai_budget
      WHERE scope_type = 'story' AND scope_id = p_story_id
      FOR UPDATE
    LOOP
      -- Period reset (daily/monthly) before metering this window.
      IF (v_row.period = 'daily'   AND v_row.last_reset_at < date_trunc('day',   now()))
      OR (v_row.period = 'monthly' AND v_row.last_reset_at < date_trunc('month', now())) THEN
        v_row.consumed_tokens   := 0;
        v_row.consumed_cost := 0;
        v_row.last_reset_at     := now();
      END IF;

      -- Meter the actual spend (post-paid).
      v_row.consumed_tokens   := v_row.consumed_tokens   + p_tokens;
      v_row.consumed_cost := v_row.consumed_cost + p_cost;

      UPDATE public.ai_budget SET
        consumed_tokens   = v_row.consumed_tokens,
        consumed_cost = v_row.consumed_cost,
        last_reset_at     = v_row.last_reset_at,
        updated_at        = now()
      WHERE id = v_row.id;

      -- Cap reached on either limited dimension?
      IF (v_row.token_limit    IS NOT NULL AND v_row.consumed_tokens   >= v_row.token_limit)
      OR (v_row.cost_limit IS NOT NULL AND v_row.consumed_cost >= v_row.cost_limit) THEN
        v_story_allowed := false;
      END IF;
    END LOOP;

    IF NOT v_story_allowed AND v_user_allowed THEN
      v_reason := 'story_budget';
    END IF;
  END IF;

  -- Audit the story-budget denial only (user denial already audited by its RPC).
  IF NOT v_story_allowed THEN
    INSERT INTO public.audit_journal (user_id, action, metadata)
    VALUES (
      p_user_id,
      'ai.budget.denied',
      jsonb_build_object(
        'reason',             'story_budget',
        'story_id',           p_story_id,
        'requested_tokens',   p_tokens,
        'requested_cost', p_cost
      )
    );
  END IF;

  RETURN jsonb_build_object(
    'allowed',     (v_user_allowed AND v_story_allowed),
    'reason',      v_reason,
    'user_quota',  v_user_result,
    'story_state', CASE WHEN p_story_id IS NULL THEN 'ok'
                        WHEN v_story_allowed     THEN 'ok'
                        ELSE 'stopped' END
  );
END;
$$;

-- The `authenticated` grant is part of the design contract (asserted by
-- src/tests/gates/ai-budget.gate.test.ts, mirroring WP 2.3's per-JWT.sub gating), even though the
-- only caller today is svc-ai-chat's reflection orchestrator
-- (services/svc-ai-chat/src/reflection/orchestrator.ts), which reaches PostgREST through
-- @aisha/postgrest-client with the service_role bearer token. The grant was never the defect:
-- granting it with no check that p_user_id was the caller, and no check that they had any claim
-- on p_story_id, was. The guard in the body enforces both, so the grant is safe.
REVOKE ALL ON FUNCTION public.fn_check_and_consume_ai_budget_audited(uuid, uuid, int, numeric) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.fn_check_and_consume_ai_budget_audited(uuid, uuid, int, numeric) TO authenticated;
GRANT EXECUTE ON FUNCTION public.fn_check_and_consume_ai_budget_audited(uuid, uuid, int, numeric) TO service_role;
