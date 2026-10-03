-- Function: aisha_choose_execution_strategy
-- AISHA core autopilot decision. Reads task + context, returns full execution plan:
--   { graph_id, mode, slot, profile, batch_eligible, strategy, required_capabilities,
--     audit_anchor, estimated_cost, reasoning }
--
-- This is the single source of truth for AISHA's "what to do" decision per task.
-- Downstream: svc-langgraph-runner uses graph_id; svc-ai-chat uses slot/profile;
-- batch routing uses strategy; cosmos anchor uses audit_anchor; OpenClaw plan/sandbox
-- triggered when required_capabilities contains openclaw_plan or openclaw_sandbox.

CREATE OR REPLACE FUNCTION public.aisha_choose_execution_strategy(
  p_task jsonb,
  p_context jsonb DEFAULT '{}'::jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
STABLE
AS $$
DECLARE
  -- Task inputs
  v_description       text   := p_task->>'description';
  v_task_type         text   := COALESCE(p_task->>'type', 'chat');
  v_deadline_hours    int    := COALESCE((p_task->>'deadline_hours')::int, 24);
  v_criticality       text   := COALESCE(p_task->>'criticality', 'normal');
  v_risk_level        text   := COALESCE(p_task->>'risk_level', 'low');
  v_expected_tokens   int    := COALESCE((p_task->>'expected_tokens')::int, 5000);
  v_agent_slug        text   := COALESCE(p_task->>'agent_slug', 'aisha');
  v_story_id          uuid   := NULLIF(p_task->>'story_id', '')::uuid;
  -- Context inputs
  v_session_id        text   := p_context->>'session_id';
  v_budget_remaining  numeric := COALESCE((p_context->>'budget_remaining')::numeric, 5.00);
  v_recent_error_rate numeric := COALESCE((p_context->>'recent_error_rate')::numeric, 0.0);
  -- Decision outputs
  v_graph_id          uuid;
  v_graph_slug        text;
  v_mode              text;
  v_slot              text;
  v_profile           text;
  v_batch_eligible    boolean := false;
  v_strategy          text;
  v_audit_anchor      boolean := false;
  v_caps              text[] := ARRAY[]::text[];
  v_needs             jsonb;   -- derived clow capability needs (write/internet/tools/runtime)
  v_estimated_cost    numeric;
  v_reasoning         text;
  v_pricing_per_1k    numeric := 0.001;  -- conservative default
  v_batch_threshold   int     := 24;     -- AISHA_BATCH_THRESHOLD_DEADLINE_HOURS default
BEGIN
  -- Auth: any authenticated caller or service_role
  IF auth.uid() IS NULL AND current_setting('role', true) != 'service_role' THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  IF v_description IS NULL OR v_description = '' THEN
    RAISE EXCEPTION 'p_task.description is required';
  END IF;

  -- ============================================================
  -- 1. Mode (strict / creative / hybrid)
  -- ============================================================
  v_mode := CASE
    WHEN v_criticality IN ('critical', 'high') THEN 'strict'
    WHEN v_task_type IN ('creative', 'story_plan', 'brand_voice') THEN 'creative'
    WHEN v_task_type IN ('reflection', 'analyze') THEN 'hybrid'
    ELSE 'strict'
  END;

  -- ============================================================
  -- 2. Audit anchor (cosmos blockchain hash)
  -- ============================================================
  v_audit_anchor := (v_criticality IN ('critical', 'high'))
                 OR (v_task_type = 'deploy')
                 OR (v_risk_level = 'high');

  -- ============================================================
  -- 3. Required capabilities
  -- ============================================================
  IF v_risk_level = 'high' THEN
    v_caps := v_caps || ARRAY['openclaw_sandbox'];
  END IF;

  -- Multi-step orchestration patterns
  IF v_description ~* '\y(deploy|migration|delivery|complex refactor|rollout)\y' THEN
    v_caps := v_caps || ARRAY['openclaw_plan'];
  END IF;

  IF v_mode = 'creative' THEN
    v_caps := v_caps || ARRAY['occipitum_creative'];
  END IF;

  IF v_audit_anchor THEN
    v_caps := v_caps || ARRAY['cosmos_anchor'];
  END IF;

  -- Hippocampus is enabled when we have a story_id (per-story scoped learnings)
  -- or when running reflection on AISHA's own work
  IF v_story_id IS NOT NULL OR v_task_type IN ('reflection', 'deploy') THEN
    v_caps := v_caps || ARRAY['hippocampus'];
  END IF;

  -- ============================================================
  -- 4. Graph selection
  -- ============================================================
  -- Derive the clow's capability needs ONCE (single producer; openclaw_resolve_clow
  -- re-derives the same from the run task so fn_resolve_runtime gets real needs).
  v_needs := derive_clow_needs(p_task);

  v_graph_slug := CASE
    WHEN v_task_type = 'deploy' THEN 'deploy-reflect'
    WHEN v_task_type IN ('reflection', 'story_plan') AND v_story_id IS NOT NULL THEN 'story-plan-reflect'
    ELSE NULL  -- No graph → direct provider call (existing flow)
  END;

  -- A task whose work needs a non-direct_llm executor (write/internet/tools or an
  -- explicit runtime hint) but matches no specific reflection graph → the
  -- runtime-execute graph, which derives the runtime + dispatches via the adapter.
  -- This is what makes openclaw/hermes REACHABLE instead of dead-in-practice.
  IF v_graph_slug IS NULL AND (v_needs->>'has_capability_need')::boolean THEN
    v_graph_slug := 'runtime-execute';
  END IF;

  IF v_graph_slug IS NOT NULL THEN
    SELECT id INTO v_graph_id
    FROM ai_workflow_definitions
    WHERE name = v_graph_slug AND is_active = true
    ORDER BY version DESC
    LIMIT 1;
  END IF;

  -- ============================================================
  -- 5. Slot classification (Soulforge heuristic, DB-side mirror of TS)
  -- ============================================================
  v_slot := CASE
    WHEN v_description ~* '\y(read|explore|fetch|open|show|browse|load)\y' AND length(v_description) < 400 THEN 'spark'
    WHEN v_description ~* '\y(write|edit|create|implement|fix|refactor|build|add)\y' THEN 'ember'
    WHEN v_description ~* '\y(review|test|check|verify|audit|validate)\y' THEN 'verify'
    WHEN v_description ~* '\y(summariz|condens|shorten|tldr)' THEN 'compact'
    WHEN v_description ~* '\y(analyz|explain|compar|evaluat|diagnos)' THEN 'semantic'
    WHEN v_description ~* '\y(search|google|lookup|web|find)\y' THEN 'webSearch'
    WHEN v_description ~* '\y(clean|format|lint|tidy)\y' THEN 'desloppify'
    ELSE 'default'
  END;

  -- ============================================================
  -- 6. Profile (budget / balanced / maxQuality)
  -- ============================================================
  v_profile := CASE
    WHEN v_budget_remaining < 1.00 THEN 'budget'
    WHEN v_criticality IN ('critical', 'high') THEN 'maxQuality'
    WHEN v_recent_error_rate > 0.10 THEN 'maxQuality'  -- escalate on flaky runs
    ELSE 'balanced'
  END;

  -- ============================================================
  -- 7. Strategy: sync vs batch
  -- ============================================================
  -- Hard blacklists for batch
  IF v_criticality IN ('critical', 'high') THEN
    v_batch_eligible := false;
  ELSIF v_deadline_hours < 1 THEN
    v_batch_eligible := false;
  ELSIF v_task_type IN ('chat') THEN
    v_batch_eligible := false;   -- interactive UX
  -- Batch eligibility heuristic
  ELSIF v_deadline_hours >= v_batch_threshold AND v_expected_tokens >= 50000 THEN
    v_batch_eligible := true;
  ELSIF v_task_type IN ('analyze', 'report', 'eval') AND v_deadline_hours >= v_batch_threshold THEN
    v_batch_eligible := true;
  END IF;

  v_strategy := CASE WHEN v_batch_eligible THEN 'batch' ELSE 'sync' END;

  -- ============================================================
  -- 8. Cost estimation (rough — refined by llmRouter at execution)
  -- ============================================================
  -- Lookup approximate $/1K tokens from get_model_pricing (existing RPC)
  -- Fallback to conservative 0.001
  BEGIN
    SELECT COALESCE(
      (get_model_pricing(NULL)->>'avg_per_1k')::numeric,
      0.001
    )
    INTO v_pricing_per_1k;
  EXCEPTION WHEN OTHERS THEN
    v_pricing_per_1k := 0.001;
  END;

  v_estimated_cost := (v_expected_tokens / 1000.0) * v_pricing_per_1k;
  IF v_strategy = 'batch' THEN
    v_estimated_cost := v_estimated_cost * 0.5;  -- 50% off batch pricing
  END IF;

  -- ============================================================
  -- 9. Reasoning string (transparency)
  -- ============================================================
  v_reasoning := format(
    'type=%s, criticality=%s, deadline=%sh, risk=%s, tokens=%s, budget=%s, errors=%s → '
    'mode=%s, slot=%s, profile=%s, strategy=%s, graph=%s, caps=%s, anchor=%s',
    v_task_type, v_criticality, v_deadline_hours, v_risk_level, v_expected_tokens,
    v_budget_remaining, v_recent_error_rate,
    v_mode, v_slot, v_profile, v_strategy, COALESCE(v_graph_slug, '<none>'),
    array_to_string(v_caps, ','), v_audit_anchor
  );

  -- Audit (deferred — STABLE prevents insert from succeeding in some contexts,
  -- so we use a write-via-trigger pattern in non-stable wrapper if needed).
  -- Here we skip inline audit because STABLE; callers should audit via
  -- decisionProvenance.record() on the AISHA side.

  RETURN jsonb_build_object(
    'graph_id', v_graph_id,
    'graph_slug', v_graph_slug,
    'mode', v_mode,
    'slot', v_slot,
    'profile', v_profile,
    'batch_eligible', v_batch_eligible,
    'strategy', v_strategy,
    'required_capabilities', to_jsonb(v_caps),
    'capability_needs', v_needs,
    'audit_anchor', v_audit_anchor,
    'estimated_cost', round(v_estimated_cost, 6),
    'reasoning', v_reasoning
  );
END;
$$;

COMMENT ON FUNCTION public.aisha_choose_execution_strategy(jsonb, jsonb) IS
  'AISHA core autopilot decision. Pure STABLE function — same input always yields '
  'same output. Returns full execution plan for downstream orchestration. '
  'Audit is the caller''s responsibility (decisionProvenance.record).';

REVOKE ALL ON FUNCTION public.aisha_choose_execution_strategy(jsonb, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.aisha_choose_execution_strategy(jsonb, jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.aisha_choose_execution_strategy(jsonb, jsonb) TO service_role;
