-- Function: aisha_resolve_clow_backend
-- Per-clow backend dispatch decision. Given a clow sub-agent's purpose +
-- constraints, returns AISHA's choice of {backend, model, strategy, mcp_servers}.
--
-- Input ingredients:
--   - p_clow: { purpose, capability_tags[], task_kind, expected_tokens, deadline_hours, max_cost, allow_batch, allow_local }
--   - p_context: { agent_slug, story_id, parent_run_id, budget_remaining }
--
-- Decision rules (transparent, STABLE):
--   1. Filter providers by enabled + healthy
--   2. Filter by capability flags (supports_tool_use, supports_vision, supports_batch)
--   3. Prefer local (Ollama/vLLM) when allow_local=true and provider can serve task
--   4. Apply deadline → batch eligibility (matches aisha_choose_execution_strategy)
--   5. Apply cost class filter: budget_remaining < $1 → cost_class='budget'
--   6. Per-(provider × task_kind) score from ai_model_benchmarks
--   7. Top candidate wins; ties broken by lowest cost
--
-- Returns ranked candidates so caller can fall back if top fails health probe.

CREATE OR REPLACE FUNCTION public.aisha_resolve_clow_backend(
  p_clow jsonb,
  p_context jsonb DEFAULT '{}'::jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
STABLE
AS $$
DECLARE
  -- Clow inputs
  v_purpose           text   := p_clow->>'purpose';
  v_capability_tags   text[] := COALESCE(
    ARRAY(SELECT jsonb_array_elements_text(p_clow->'capability_tags')),
    ARRAY[]::text[]
  );
  v_task_kind         text   := COALESCE(p_clow->>'task_kind', 'chat');
  -- Raw caller inputs; policy defaults applied in BEGIN once ai_resolver_policy is loaded
  -- (was COALESCE(..., <literal>) — the literal now lives in the operator-tunable policy row).
  v_expected_tokens   int    := (p_clow->>'expected_tokens')::int;
  v_deadline_hours    int    := (p_clow->>'deadline_hours')::int;
  v_max_cost      numeric := (p_clow->>'max_cost')::numeric;
  v_allow_batch       boolean := COALESCE((p_clow->>'allow_batch')::boolean, true);
  v_allow_local       boolean := COALESCE((p_clow->>'allow_local')::boolean, true);
  v_cloud_forbidden   boolean := COALESCE((p_clow->>'cloud_forbidden')::boolean, false);
  v_needs_tools       boolean := COALESCE((p_clow->>'needs_tools')::boolean, false);
  v_needs_vision      boolean := COALESCE((p_clow->>'needs_vision')::boolean, false);

  -- Context inputs
  v_budget_remaining  numeric := (p_context->>'budget_remaining')::numeric;  -- policy default in BEGIN
  v_session_id        text    := p_context->>'session_id';
  v_parent_run_id     uuid    := NULLIF(p_context->>'parent_run_id', '')::uuid;
  -- Runtime serviceability: provider slugs whose key/endpoint is configured in the
  -- CALLING process (from getAllBackends). Empty = unconstrained (e.g. the scheduled
  -- discovery probe) so a 0-length array does NOT filter; non-empty intersects.
  v_serviceable       text[]  := ARRAY(SELECT jsonb_array_elements_text(p_context->'serviceable_slugs'));
  -- §19.4 per-instance scoping: the caller's instance (from p_context). Empty/NULL
  -- ⇒ only base/global providers (scoped_to_instance_id IS NULL) are candidates.
  v_instance_id       uuid    := NULLIF(p_context->>'instance_id', '')::uuid;

  -- Computed
  v_prefer_batch      boolean;
  v_cost_class_filter text;
  v_candidates        jsonb;
  v_top               jsonb;
  v_reasoning         text;
  -- Operator-tunable decision policy (weights/thresholds/defaults) — see ai_resolver_policy.
  v_pol               public.ai_resolver_policy%ROWTYPE;
BEGIN
  IF auth.uid() IS NULL AND current_setting('role', true) != 'service_role' THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;
  IF v_purpose IS NULL OR v_purpose = '' THEN
    RAISE EXCEPTION 'p_clow.purpose is required';
  END IF;

  -- Operator-tunable decision policy (public.ai_resolver_policy): the GLOBAL row, with an optional
  -- per-task-kind override (global×kind > global×*). The GLOBAL row is seeded + healed to ALWAYS
  -- exist; its absence is a fail-loud config error — NEVER a silent re-baked literal. (story +
  -- instance scopes are @scope-reserved forward seams — not yet read here.)
  SELECT * INTO v_pol
    FROM public.ai_resolver_policy
   WHERE is_active AND scope_type = 'global'
     AND (task_kind IS NULL OR task_kind = v_task_kind)
   ORDER BY (task_kind IS NOT NULL) DESC
   LIMIT 1;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'ai_resolver_policy has no active GLOBAL row — resolver decision policy is unconfigured (seed 37 / heals must apply)';
  END IF;

  -- Apply policy defaults for caller-omitted inputs (were hardcoded COALESCE literals).
  v_expected_tokens  := COALESCE(v_expected_tokens,  v_pol.default_expected_tokens);
  v_deadline_hours   := COALESCE(v_deadline_hours,   v_pol.default_deadline_hours);
  v_max_cost     := COALESCE(v_max_cost,     v_pol.default_max_cost);
  v_budget_remaining := COALESCE(v_budget_remaining, v_pol.default_budget_remaining);

  -- Batch eligibility (mirrors aisha_choose_execution_strategy)
  v_prefer_batch :=
    v_allow_batch
    AND v_deadline_hours >= v_pol.batch_min_deadline_hours
    AND v_expected_tokens >= v_pol.batch_min_tokens
    AND v_task_kind NOT IN ('chat')
    AND p_clow->>'criticality' IS DISTINCT FROM 'critical'
    AND p_clow->>'criticality' IS DISTINCT FROM 'high';

  -- Cost class
  v_cost_class_filter := CASE
    WHEN v_budget_remaining < v_pol.budget_remaining_floor OR v_max_cost < v_pol.budget_max_cost THEN 'budget'
    WHEN v_max_cost > v_pol.premium_max_cost THEN 'premium'
    ELSE 'standard'
  END;

  -- Build candidate list: join providers × models × benchmarks
  -- Ranking: bench-score weighted by cost preference; local providers boosted when allow_local=true.
  SELECT COALESCE(jsonb_agg(c.cand ORDER BY (c.cand->>'score')::numeric DESC), '[]'::jsonb)
  INTO v_candidates
  FROM (
    -- rank, do NOT truncate: the WHERE clause already bounds the set to serviceable ×
    -- available × capability-matched models — that filter IS the bound. An extra row cap
    -- on TOP of it silently drops the lowest-scored SERVICEABLE models, which is exactly
    -- the tail reResolveExcluding falls back to. When the filtered population exceeded the
    -- cap (e.g. 11 chat-capable candidates vs a LIMIT 10), a legitimately-resolvable model
    -- was hidden from EVERY candidates[] consumer — a false "no backend" that violates the
    -- no-fallback contract (fail loud only on a GENUINELY empty set). A predecessor fix
    -- (ef6409ba) corrected WHICH rows survived (order-before-limit); this removes the cap.
    SELECT _ranked.cand FROM (
    SELECT jsonb_build_object(
      'provider_slug',     p.slug,
      'provider_id',       p.id,
      'backend_kind',      p.backend_kind,
      'endpoint_url',      p.endpoint_url,
      'auth_env_var',      p.auth_env_var,
      'model_id',          r.model_id,
      'model_registry_id', r.id,
      -- Capacity + pricing of the RESOLVED model (no extra join — ai_model_registry r is
      -- already joined). The Omni /v1 lane clamps client max_tokens to max_output_tokens and
      -- derives a token-aware spend estimate from the pricing — both DYNAMIC, never hardcoded.
      -- NULL when the registry row lacks the data → the caller falls back to a config default.
      'max_output_tokens',  r.max_output_tokens,
      'context_window',     r.context_window,
      'input_price_per_m',  r.input_price_per_m,
      'output_price_per_m', r.output_price_per_m,
      'cost_class',        p.cost_class,
      'is_local',          (p.backend_kind IN ('local_ollama', 'local_vllm')),
      'supports_batch',    p.supports_batch,
      'use_batch',         (v_prefer_batch AND p.supports_batch),
      'strategy',          CASE WHEN v_prefer_batch AND p.supports_batch THEN 'batch' ELSE 'sync' END,
      'score',             ROUND(
        (
          COALESCE(b.overall_score, v_pol.default_bench) * v_pol.bench_weight
          + CASE WHEN p.backend_kind IN ('local_ollama','local_vllm') AND v_allow_local THEN v_pol.local_bonus ELSE 0.0 END
          + CASE WHEN p.cost_class = v_cost_class_filter THEN v_pol.cost_match_weight ELSE 0.0 END
          + CASE WHEN v_needs_tools AND r.is_function_calling THEN v_pol.tool_match_weight ELSE 0.0 END
          + CASE WHEN v_needs_vision AND r.is_vision THEN v_pol.vision_match_weight ELSE 0.0 END
        )::numeric, 4
      ),
      'reason', format(
        -- PostgreSQL format() supports only %s/%I/%L — NOT C-style %.2f. The old
        -- '%.2f' raised "unrecognized format() type specifier" on EVERY candidate,
        -- so the resolver always errored and openclaw_resolve_clow swallowed it →
        -- the hardcoded matrices were the de-facto path. Round + %s instead.
        'bench=%s local_bonus=%s cost_match=%s tool_match=%s vision_match=%s',
        round(COALESCE(b.overall_score, v_pol.default_bench), 2),
        (p.backend_kind IN ('local_ollama','local_vllm') AND v_allow_local),
        (p.cost_class = v_cost_class_filter),
        (v_needs_tools AND r.is_function_calling),
        (v_needs_vision AND r.is_vision)
      )
    ) AS cand
    FROM public.ai_provider_registry p
    JOIN public.ai_model_registry r
      ON COALESCE(r.provider_registry_id, NULL) = p.id
      OR r.provider = p.slug                         -- fallback for unmigrated rows
    LEFT JOIN public.ai_model_benchmarks b
      ON b.model_registry_id = r.id AND b.task_type = v_task_kind
    WHERE p.is_enabled
      AND p.last_health_status = ANY(v_pol.health_allow_set)
      AND r.is_available AND NOT r.is_deprecated
      -- RAG brick 1a: task-kind ⇄ embedding-capability gate (symmetric with the
      -- is_function_calling / is_vision filters below — capability-derived, never an
      -- allow-list). An embedding task MUST resolve to an embedding model; a non-embedding
      -- task must NOT pick an embedding-only model (they are not chat-capable). Without
      -- this, resolveRagBackend('rag.embedding') ranked CHAT models for an embedding task.
      AND (v_task_kind <> 'embedding' OR r.is_embedding)
      AND (v_task_kind =  'embedding' OR NOT r.is_embedding)
      -- Symmetric chat-capability gate (capability-derived from the model id at discovery
      -- via deriveModelCaps, NEVER an allow-list): a GENERATIVE (non-embedding) task MUST
      -- resolve to a chat-capable model. Without it, non-chat AND non-embedding models
      -- (tts/whisper/dall-e/moderation/realtime/audio — is_chat_capable=false) leaked into
      -- chat resolution, because only the embedding gate above existed. Proved live on the
      -- local stack: gpt-4o-mini forced is_chat_capable=false still ranked for a chat task
      -- until this gate landed.
      AND (v_task_kind = 'embedding' OR r.is_chat_capable)
      -- Moderation: exclude an admin-REJECTED model, unless an admin explicitly
      -- force-activated it (is_admin_active). NOT a sole is_admin_active gate — that
      -- DEFAULTs false (the seed never sets it) so requiring it would exclude every
      -- model; a discovered/pending model stays resolvable (auto-setup).
      AND (r.eval_status <> 'rejected' OR r.is_admin_active)
      AND (NOT v_needs_tools OR r.is_function_calling)
      AND (NOT v_needs_vision OR r.is_vision)
      AND (NOT v_prefer_batch OR p.supports_batch)
      -- allow_local=false hard-excludes LOCAL backends (discovery §6 invariant).
      AND (v_allow_local OR p.backend_kind NOT IN ('local_ollama','local_vllm'))
      -- §11 residency hard-filter (ORTHOGONAL to the local opt-out above): when
      -- clow.cloud_forbidden=true (set by detectDataSensitivity at confidential) ONLY
      -- on-prem backends are eligible, so cloud (direct_cloud/llm_gateway) reaches ZERO
      -- invocations. Expressed as a POSITIVE local-allow rather than a llm_gateway
      -- blacklist, so when cloud IS permitted (cloud_forbidden=false) the gateway stays
      -- a first-class peer (llm-gateway resolver-contract: never blacklist the gateway).
      AND (NOT v_cloud_forbidden OR p.backend_kind IN ('local_ollama','local_vllm'))
      -- Only providers serviceable by the caller (key present). Not a roster — the
      -- array IS the live runtime key truth; empty = unconstrained.
      AND (cardinality(v_serviceable) = 0 OR p.slug = ANY(v_serviceable))
      -- §19.4 per-instance scoping: SECURITY DEFINER bypasses RLS, so tenant-filter
      -- candidates EXPLICITLY here — base/global (NULL) or the caller's own instance.
      AND (p.scoped_to_instance_id IS NULL OR p.scoped_to_instance_id = v_instance_id)
    ) _ranked
    ORDER BY (_ranked.cand->>'score')::numeric DESC
  ) c;

  -- Top candidate
  v_top := COALESCE(v_candidates->0, NULL);

  IF v_top IS NULL THEN
    v_reasoning := format(
      'No backend matched: task_kind=%s, capability_tags=%s, batch_pref=%s, cost_class=%s, allow_local=%s, needs_tools=%s, needs_vision=%s',
      v_task_kind, array_to_string(v_capability_tags, ','),
      v_prefer_batch, v_cost_class_filter, v_allow_local, v_needs_tools, v_needs_vision
    );

    -- No substitution: an empty derived set is a real "no capable + available +
    -- serviceable provider" condition the caller must surface (fail loud), not mask.
    RETURN jsonb_build_object(
      'resolved', false,
      'reasoning', v_reasoning,
      'candidates', v_candidates
    );
  END IF;

  v_reasoning := format(
    'Picked %s/%s (score=%s, strategy=%s) — %s',
    v_top->>'provider_slug', v_top->>'model_id',
    v_top->>'score', v_top->>'strategy', v_top->>'reason'
  );

  RETURN jsonb_build_object(
    'resolved', true,
    'top', v_top,
    'candidates', v_candidates,
    'reasoning', v_reasoning,
    'inputs', jsonb_build_object(
      'task_kind', v_task_kind,
      'expected_tokens', v_expected_tokens,
      'deadline_hours', v_deadline_hours,
      'max_cost', v_max_cost,
      'prefer_batch', v_prefer_batch,
      'cost_class_filter', v_cost_class_filter,
      'allow_local', v_allow_local,
      -- The ACTIVE operator-tunable policy that produced this decision (the lens persisted by
      -- fn_record_execution_decision: which weights/thresholds were live + which row id).
      'policy', jsonb_build_object(
        'id', v_pol.id, 'scope_type', v_pol.scope_type,
        'bench_weight', v_pol.bench_weight, 'local_bonus', v_pol.local_bonus,
        'cost_match_weight', v_pol.cost_match_weight, 'tool_match_weight', v_pol.tool_match_weight,
        'vision_match_weight', v_pol.vision_match_weight,
        'budget_remaining_floor', v_pol.budget_remaining_floor,
        'budget_max_cost', v_pol.budget_max_cost, 'premium_max_cost', v_pol.premium_max_cost,
        'batch_min_deadline_hours', v_pol.batch_min_deadline_hours, 'batch_min_tokens', v_pol.batch_min_tokens,
        'health_allow_set', to_jsonb(v_pol.health_allow_set)
      )
    )
  );
END;
$$;

COMMENT ON FUNCTION public.aisha_resolve_clow_backend(jsonb, jsonb) IS
  'Per-clow backend resolver. Ranks providers × models for a specific sub-agent task. '
  'STABLE; returns ranked candidates + top pick + transparent reasoning. '
  'Caller is OpenClaw bridge route (TS layer) which then dispatches the clow with the resolved backend.';

REVOKE ALL ON FUNCTION public.aisha_resolve_clow_backend(jsonb, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.aisha_resolve_clow_backend(jsonb, jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.aisha_resolve_clow_backend(jsonb, jsonb) TO service_role;
