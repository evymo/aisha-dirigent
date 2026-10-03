-- Source of Truth: route_task
-- Purpose: Route an AI task to the appropriate agent pipeline based on task kind and risk profile.
--          Consults dirigent's decision tree first, falls back to hardcoded CASE.
--          Creates an ai_run record and traces the routing decision.
-- Used by: ai-router edge function, orchestrationBridge.ts
-- Migration: 20260216_aisha_phase3_router.sql (original), 20260309090000 (decision tree integration)

CREATE OR REPLACE FUNCTION public.route_task(
  p_task_kind text,
  p_risk_profile text DEFAULT 'low'::text,
  p_domain text[] DEFAULT '{}'::text[],
  p_tech text[] DEFAULT '{}'::text[],
  p_story_id uuid DEFAULT NULL::uuid,
  p_constraints jsonb DEFAULT '{}'::jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_run_id uuid;
  v_agents jsonb := '[]'::jsonb;
  v_tools text[] := '{}';
  -- K-36: zákazy agentů trasy (agent_catalog.denied_tools) — dřív se za běhu nevynucovaly vůbec.
  v_denied text[] := '{}';
  v_agent RECORD;
  v_step int := 0;
  v_agent_slugs text[];
  v_model_key text;
  v_actual_model text;
  v_max_loops int := 3;
  v_must_compliance boolean := false;
  v_require_human boolean := false;
  -- Decision tree variables
  v_tree_context jsonb;
  v_tree_result jsonb;
  v_tree_status text;
  v_tree_agent text;
  v_tree_used boolean := false;
  v_call_mode boolean := false;  -- explicit agent_slug pull (call-mode override)
  v_compliance_result jsonb;
BEGIN
  -- ===== PHASE 1: Try decision tree routing =====
  v_tree_context := jsonb_build_object(
    'task', jsonb_build_object(
      'kind', p_task_kind,
      'category', COALESCE(p_constraints->>'task_category', p_task_kind),
      'risk_level', p_risk_profile
    ),
    'request', p_constraints
  );

  v_tree_result := public.consult_decision_tree('dirigent', 'task_routing', v_tree_context);
  v_tree_status := v_tree_result->>'status';

  IF v_tree_status = 'resolved' AND v_tree_result->>'type' = 'action' THEN
    -- Tree resolved to an agent — use it as primary agent
    v_tree_agent := v_tree_result->>'agent_slug';
    v_tree_used := true;

    -- Build pipeline: for project_delivery add planner+primary+verifier, otherwise just primary
    IF p_task_kind = 'project_delivery' THEN
      v_agent_slugs := ARRAY['dev_patch', 'compliance_gate', 'verifier'];
      v_must_compliance := true;
    ELSE
      v_agent_slugs := ARRAY[v_tree_agent];
    END IF;

  ELSIF v_tree_status = 'resolved' AND v_tree_result->>'type' = 'escalation' THEN
    -- Tree says escalate — use fallback pipeline but force human approval
    v_require_human := true;
    v_tree_used := true;
    v_agent_slugs := ARRAY['librarian'];

  ELSE
    -- ===== PHASE 2: Fallback to hardcoded CASE =====
    CASE p_task_kind
      WHEN 'project_delivery' THEN
        v_agent_slugs := ARRAY['dev_patch','compliance_gate','verifier'];
        v_must_compliance := true;
      WHEN 'pr_gate' THEN
        v_agent_slugs := ARRAY['compliance_gate'];
        v_must_compliance := true;
      WHEN 'chat' THEN
        v_agent_slugs := ARRAY['librarian'];
      WHEN 'incident' THEN
        v_agent_slugs := ARRAY['debug_agent','dev_patch'];
      WHEN 'doc_update' THEN
        v_agent_slugs := ARRAY['librarian'];
      ELSE
        v_agent_slugs := ARRAY['librarian'];
    END CASE;
  END IF;

  -- ===== Call-mode override: explicit marketplace agent =====
  -- A caller can request a specific published+materialized MARKETPLACE agent via
  -- p_constraints.agent_slug. The EXISTS is scoped to source_plugin_id IS NOT NULL
  -- so this pull can ONLY reach marketplace-materialized agents — a caller can NOT
  -- summon a privileged built-in/system agent (dev_patch, compliance_gate,
  -- verifier, debug_agent; source_plugin_id IS NULL) by slug and thereby bypass
  -- the task-kind guards that normally gate those. System agents stay reachable
  -- only via the task_kind tree/CASE. Risk + compliance below still apply.
  -- Unknown/inactive/system slug → fall through to normal routing (safe).
  IF NULLIF(p_constraints->>'agent_slug', '') IS NOT NULL
     AND EXISTS (
       SELECT 1 FROM agent_catalog
        WHERE slug = p_constraints->>'agent_slug'
          AND is_active = true
          AND source_plugin_id IS NOT NULL
     )
  THEN
    v_agent_slugs := ARRAY[p_constraints->>'agent_slug'];
    v_tree_used := false;
    v_call_mode := true;
  END IF;

  -- ===== Risk escalation =====
  IF p_risk_profile = 'high' THEN
    v_model_key := 'high_risk';
    v_require_human := true;
    v_must_compliance := true;
  ELSIF p_risk_profile = 'medium' THEN
    v_model_key := 'medium_risk';
    v_must_compliance := true;
  ELSE
    v_model_key := 'low_risk';
  END IF;

  -- ===== Compliance tree consultation (if needed) =====
  -- Consult the compliance tree for tree-routed AND call-mode (explicit pull)
  -- paths — an explicit marketplace-agent pull must NOT skip risk escalation
  -- (without this, a medium-risk call-mode route appends compliance_gate but
  -- never sets require_human_approval). The pure task-kind CASE fallback keeps
  -- its prior behavior (append compliance_gate as the safety default).
  IF v_must_compliance AND (v_tree_used OR v_call_mode) THEN
    v_compliance_result := public.consult_decision_tree('compliance_gate', 'risk_assessment', v_tree_context);
    IF v_compliance_result->>'status' = 'resolved' THEN
      IF v_compliance_result->>'decision' = 'escalated' THEN
        v_require_human := true;
      END IF;
      -- If not auto-approved, ensure compliance_gate is in pipeline
      IF v_compliance_result->>'decision' != 'approved' THEN
        IF NOT (v_agent_slugs @> ARRAY['compliance_gate']) THEN
          v_agent_slugs := array_append(
            v_agent_slugs[1:array_length(v_agent_slugs, 1) - 1],
            'compliance_gate'
          ) || v_agent_slugs[array_length(v_agent_slugs, 1):array_length(v_agent_slugs, 1)];
        END IF;
      END IF;
    ELSE
      -- Compliance tree unavailable — add compliance_gate as safety default
      IF NOT (v_agent_slugs @> ARRAY['compliance_gate']) THEN
        v_agent_slugs := array_append(v_agent_slugs, 'compliance_gate');
      END IF;
    END IF;
  ELSIF v_must_compliance THEN
    -- Pure task-kind CASE fallback (no tree, no explicit pull): append
    -- compliance_gate as the safety default (unchanged prior behavior).
    IF NOT (v_agent_slugs @> ARRAY['compliance_gate']) THEN
      v_agent_slugs := array_append(v_agent_slugs, 'compliance_gate');
    END IF;
  END IF;

  -- ===== Build agent pipeline =====
  FOR v_agent IN
    SELECT ac.slug, ac.default_model, ac.model_overrides,
           ac.allowed_tools, ac.denied_tools, ac.default_context_profile, ac.max_loops,
           ac.autonomy_level, ac.safety_level
    FROM agent_catalog ac
    WHERE ac.slug = ANY(v_agent_slugs) AND ac.is_active = true
    ORDER BY array_position(v_agent_slugs, ac.slug)
  LOOP
    v_step := v_step + 1;

    -- Model override by risk
    v_actual_model := COALESCE(
      v_agent.model_overrides->>v_model_key,
      v_agent.default_model
    );

    -- Autonomy-based stop conditions: manual agents always require human approval
    IF v_agent.autonomy_level = 'manual' THEN
      v_require_human := true;
    END IF;

    v_agents := v_agents || jsonb_build_object(
      'slug', v_agent.slug,
      'model', v_actual_model,
      'context_profile', v_agent.default_context_profile,
      'step_index', v_step,
      'autonomy_level', COALESCE(v_agent.autonomy_level, 'semi'),
      'safety_level', COALESCE(v_agent.safety_level, 'standard')
    );

    -- Merge allowed tools; zákazy se sbírají zvlášť a odečtou se níž (zákaz vyhrává nad povolením).
    v_tools := v_tools || v_agent.allowed_tools;
    v_denied := v_denied || COALESCE(v_agent.denied_tools, '{}'::text[]);
    v_max_loops := GREATEST(v_max_loops, v_agent.max_loops);
  END LOOP;

  -- Safety fallback: if agent_catalog is incomplete, return a minimal librarian route.
  IF v_step = 0 THEN
    v_agents := jsonb_build_array(
      jsonb_build_object(
        'slug', 'librarian',
        'model', 'fast',
        'context_profile', 'chat_lightweight',
        'step_index', 1
      )
    );
    v_step := 1;
    v_tools := ARRAY[]::text[];
  END IF;

  -- Deduplicate tools; zakázaný nástroj kteréhokoli agenta trasy z povolených vypadne (K-36).
  SELECT COALESCE(array_agg(DISTINCT d), '{}'::text[]) INTO v_denied FROM unnest(v_denied) AS d;
  SELECT array_agg(DISTINCT t) INTO v_tools FROM unnest(v_tools) AS t WHERE t <> ALL(v_denied);

  -- ===== Create ai_run =====
  INSERT INTO ai_runs (kind, story_id, status, route_plan)
  VALUES (p_task_kind, p_story_id, 'running', jsonb_build_object(
    'agents', v_agents,
    'tools_allowlist', to_jsonb(v_tools),
    'tools_denylist', to_jsonb(v_denied),
    'stop_conditions', jsonb_build_object(
      'max_loops', v_max_loops,
      'must_pass_compliance', v_must_compliance,
      'require_human_approval', v_require_human
    ),
    'risk_profile', p_risk_profile,
    'domain', to_jsonb(p_domain),
    'tech', to_jsonb(p_tech),
    'constraints', p_constraints,
    'routing_method', CASE WHEN v_tree_used THEN 'decision_tree' ELSE 'hardcoded' END
  ))
  RETURNING id INTO v_run_id;

  -- ===== Trace the route decision =====
  INSERT INTO ai_trace_events (run_id, event_type, operation, status, request_summary, response_summary)
  VALUES (v_run_id, 'route_decision', 'route_task', 'ok',
    jsonb_build_object('task_kind', p_task_kind, 'risk', p_risk_profile, 'tree_used', v_tree_used),
    jsonb_build_object(
      'agent_count', v_step,
      'tools_count', array_length(v_tools, 1),
      'routing_method', CASE WHEN v_tree_used THEN 'decision_tree' ELSE 'hardcoded' END,
      'tree_result', CASE WHEN v_tree_used THEN v_tree_result ELSE NULL END
    )
  );

  RETURN jsonb_build_object(
    'run_id', v_run_id,
    'agents', v_agents,
    'tools_allowlist', v_tools,
    'tools_denylist', v_denied,
    'stop_conditions', jsonb_build_object(
      'max_loops', v_max_loops,
      'must_pass_compliance', v_must_compliance,
      'require_human_approval', v_require_human
    ),
    'routing_method', CASE WHEN v_tree_used THEN 'decision_tree' ELSE 'hardcoded' END
  );
END;
$function$;

-- Permissions
REVOKE ALL ON FUNCTION public.route_task(text, text, text[][], text[][], uuid, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.route_task(text, text, text[][], text[][], uuid, jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.route_task(text, text, text[][], text[][], uuid, jsonb) TO service_role;
