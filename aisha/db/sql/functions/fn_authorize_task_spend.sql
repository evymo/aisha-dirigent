-- ============================================================================
-- Source of Truth: fn_authorize_task_spend
-- Purpose: THE pre-flight spend decision — called at admission points
--          (fn_create_workflow_run, create_ai_run, enqueue_agent_run, future
--          CLI spawner) before a task starts. Combines:
--            estimate  — fn_estimate_task_cost (history → catalog fallback)
--            policy    — ai_spend_policies, most specific active row wins:
--                        (story,kind) > (story,*) > (global,kind) > (global,*);
--                        no row → catalog defaults (allow under p90,
--                        ask above p90, deny above 3×p90)
--            budget    — ai_budget remaining across ALL periods (lifetime,
--                        daily, monthly — fixes the lifetime-only admission gap)
--          Decision semantics:
--            allow — silent start
--            ask   — caller creates the run blocked (awaiting='spend_approval');
--                    human approves in Mission Control (may raise budget)
--            deny  — hard policy ceiling; caller refuses or blocks with reason
--          Estimate-vs-budget: projected p90 exceeding ANY remaining budget
--          dimension → ask (never silent), because a human can raise the cap.
--          Stack-default stories stay exempt (platform AI never bricked).
-- Security: SECURITY DEFINER, read-only. authenticated + service_role.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.fn_authorize_task_spend(
  p_kind     text,
  p_story_id uuid DEFAULT NULL,
  p_estimate numeric DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_estimate    jsonb;
  v_est     numeric;
  v_policy      public.ai_spend_policies%ROWTYPE;
  v_allow_under numeric;
  v_ask_over    numeric;
  v_deny_over   numeric;
  v_cat_p90     numeric;
  v_policy_src  text;
  v_is_stack    boolean := false;
  v_budget      record;
  v_budgets     jsonb := '[]'::jsonb;
  v_over_budget boolean := false;
  v_decision    text;
  v_reason      text;
BEGIN
  IF auth.uid() IS NULL
     AND (current_setting('request.jwt.claims', true)::jsonb->>'role') <> 'service_role'
  THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '42501';
  END IF;

  IF p_kind IS NULL OR btrim(p_kind) = '' THEN
    RAISE EXCEPTION 'fn_authorize_task_spend: p_kind required' USING ERRCODE = '22023';
  END IF;

  -- 1. Estimate (caller-provided override wins — e.g. router already knows)
  v_estimate := public.fn_estimate_task_cost(p_kind, p_story_id);
  v_est  := COALESCE(p_estimate, NULLIF(v_estimate->>'usd_p90', '')::numeric);

  -- 2. Stack-default exemption (mirror of fn_create_workflow_run admission)
  IF p_story_id IS NOT NULL THEN
    SELECT COALESCE(ps.is_stack_default, false) INTO v_is_stack
    FROM public.partner_stories ps WHERE ps.id = p_story_id;
  END IF;
  IF COALESCE(v_is_stack, false) THEN
    RETURN jsonb_build_object(
      'decision', 'allow',
      'reason', 'stack_default_story_exempt',
      'estimate', v_estimate,
      'budgets', v_budgets
    );
  END IF;

  -- 3. Policy resolution: most specific active row wins.
  SELECT * INTO v_policy
  FROM public.ai_spend_policies sp
  WHERE sp.is_active
    AND (
      (sp.scope_type = 'story'  AND sp.scope_id = p_story_id AND sp.task_kind = p_kind)
      OR (sp.scope_type = 'story'  AND sp.scope_id = p_story_id AND sp.task_kind IS NULL)
      OR (sp.scope_type = 'global' AND sp.task_kind = p_kind)
      OR (sp.scope_type = 'global' AND sp.task_kind IS NULL)
    )
  ORDER BY
    CASE
      WHEN sp.scope_type = 'story'  AND sp.task_kind IS NOT NULL THEN 0
      WHEN sp.scope_type = 'story'  AND sp.task_kind IS NULL     THEN 1
      WHEN sp.scope_type = 'global' AND sp.task_kind IS NOT NULL THEN 2
      ELSE 3
    END
  LIMIT 1;

  IF v_policy.id IS NOT NULL THEN
    v_policy_src  := v_policy.scope_type || ':' || COALESCE(v_policy.task_kind, '*');
    v_allow_under := v_policy.auto_allow_under;
    v_ask_over    := v_policy.ask_over;
    v_deny_over   := v_policy.deny_over;
  ELSE
    -- Zero-config defaults from the STABLE cost-class band (decided 2026-06-12:
    -- allow under class p90, ask above it, hard-deny above 3×p90).
    -- The threshold comes from the CATALOG band, NOT from the estimate: the
    -- estimate prefers history, so a kind/story running hotter than its catalog
    -- band must trip 'ask' — comparing the (history) estimate against its own
    -- p90 would always tie and make EVERYTHING ask.
    v_policy_src := 'catalog_default';
    SELECT c.usd_p90 INTO v_cat_p90
    FROM public.ai_cost_class_catalog c
    WHERE c.kind = p_kind AND c.is_active;
    -- Fall back to the estimate's own p90 if the kind has no catalog row
    -- (strict '>' below then lets a within-band run allow).
    v_ask_over    := COALESCE(v_cat_p90, NULLIF(v_estimate->>'usd_p90', '')::numeric);
    v_allow_under := v_ask_over;
    v_deny_over   := v_ask_over * 3;
  END IF;

  -- 4. Budget remaining across ALL periods with a configured cap.
  FOR v_budget IN
    SELECT ab.period,
           ab.cost_limit,
           ab.consumed_cost,
           ab.token_limit,
           ab.consumed_tokens
    FROM public.ai_budget ab
    WHERE ab.scope_type = 'story'
      AND ab.scope_id = p_story_id
      AND (ab.cost_limit IS NOT NULL OR ab.token_limit IS NOT NULL)
  LOOP
    v_budgets := v_budgets || jsonb_build_object(
      'period', v_budget.period,
      'cost_limit', v_budget.cost_limit,
      'consumed_cost', v_budget.consumed_cost,
      'remaining',
        CASE WHEN v_budget.cost_limit IS NULL THEN NULL
             ELSE v_budget.cost_limit - v_budget.consumed_cost END,
      'token_limit', v_budget.token_limit,
      'consumed_tokens', v_budget.consumed_tokens
    );
    IF v_budget.cost_limit IS NOT NULL AND v_est IS NOT NULL
       AND v_budget.consumed_cost + v_est > v_budget.cost_limit THEN
      v_over_budget := true;
    END IF;
    IF v_budget.cost_limit IS NOT NULL
       AND v_budget.consumed_cost >= v_budget.cost_limit THEN
      v_over_budget := true;
    END IF;
    IF v_budget.token_limit IS NOT NULL
       AND v_budget.consumed_tokens >= v_budget.token_limit THEN
      v_over_budget := true;
    END IF;
  END LOOP;

  -- 5. Decision.
  IF v_est IS NULL THEN
    -- Unknown kind, no history, no catalog band: a human should look once;
    -- after the first few runs, history takes over and this self-resolves.
    v_decision := 'ask';
    v_reason   := 'no_estimate_available';
  ELSIF v_deny_over IS NOT NULL AND v_est >= v_deny_over THEN
    v_decision := 'deny';
    v_reason   := format('estimate %s >= deny threshold %s', v_est, v_deny_over);
  ELSIF v_over_budget THEN
    v_decision := 'ask';
    v_reason   := 'projected_cost_exceeds_remaining_budget';
  ELSIF v_ask_over IS NOT NULL AND v_est > v_ask_over THEN
    -- Strict '>' so a run whose conservative estimate sits exactly at the band
    -- (the cold-start case: catalog estimate == catalog threshold) ALLOWS; only
    -- a run projected ABOVE the band asks.
    v_decision := 'ask';
    v_reason   := format('estimate %s > ask threshold %s', v_est, v_ask_over);
  ELSE
    v_decision := 'allow';
    v_reason   := 'within_policy';
  END IF;

  RETURN jsonb_build_object(
    'decision', v_decision,
    'reason', v_reason,
    'estimate', v_estimate,
    'estimate_used', v_est,
    'policy_source', v_policy_src,
    'thresholds', jsonb_build_object(
      'allow_under', v_allow_under,
      'ask_over', v_ask_over,
      'deny_over', v_deny_over
    ),
    'budgets', v_budgets
  );
END;
$$;

REVOKE ALL ON FUNCTION public.fn_authorize_task_spend(text, uuid, numeric) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.fn_authorize_task_spend(text, uuid, numeric) TO authenticated;
GRANT EXECUTE ON FUNCTION public.fn_authorize_task_spend(text, uuid, numeric) TO service_role;

COMMENT ON FUNCTION public.fn_authorize_task_spend(text, uuid, numeric) IS
  'Pre-flight spend authorization: estimate (history→catalog) × ai_spend_policies (most specific wins, catalog-band default) × ai_budget remaining (all periods) → {decision: allow|ask|deny, reason, estimate, thresholds, budgets}.';
