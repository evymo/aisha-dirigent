-- ==============================================================================
-- Anthropic Operating Principles — governed expert_rules (core layer)
-- ==============================================================================
-- odysseus impl/16: AISHA "knows and enforces" the Anthropic operating
-- principles by carrying them through her OWN governance path — expert_rules →
-- compose_context ruleset layer + CLAUDE.md overlay (generate-ide-instructions)
-- → knowledge_attribution. A rule without technical enforcement is just text,
-- so every rule's ai_instructions names its enforcement point (G4 gate,
-- impl 01 toolsAllowlist wire, impl 03 budget/compaction, parity package,
-- 05A SSRF, agent-runner permission gates).
--
-- SOURCE ONBOARDING CONTRACT classification (docs/enterprise/
-- SOURCE_ONBOARDING_CONTRACT.md — mandatory 4-dim classification):
--   source_type       = external            (Anthropic published guidance)
--   data_sensitivity  = public              (public engineering practices)
--   retention_class   = long_term           (operating doctrine)
--   legal_basis       = legitimate_interest (operational governance)
-- The classification is mirrored in ai_context_tags on every rule so the
-- retrieval layer and attribution can filter on it.
--
-- Idempotent: ON CONFLICT (slug) DO UPDATE (rules are platform doctrine — a
-- re-seed refreshes the directive text). Skips gracefully when the partner
-- bootstrap has not run yet (author_partner_id is NOT NULL by schema);
-- re-run the seed after onboarding to load the principles.
-- Conformance: src/tests/gates/anthropic-principles-conformance.gate.test.ts
-- ==============================================================================

DO $$
DECLARE
  v_partner_id uuid;
BEGIN
  SELECT id INTO v_partner_id FROM partner_profiles ORDER BY created_at LIMIT 1;
  IF v_partner_id IS NULL THEN
    RAISE NOTICE 'No partner_profiles found — skipping Anthropic operating principles seed (re-run after partner bootstrap).';
    RETURN;
  END IF;

  -- 1. Evals are load-bearing: no model migration without a green eval.
  INSERT INTO expert_rules (
    slug, title, summary, body_markdown, category,
    author_partner_id, visibility,
    ai_instructions, ai_context_tags, status, is_verified, version, published_at
  ) VALUES (
    'anthropic-eval-before-model-migration',
    'Eval before model migration',
    'Changing the operative default model requires a passing eval; without a green eval the default does not change.',
    E'# Eval before model migration\n\nEvals are load-bearing: a model swap without an eval is a regression waiting in production. Before activating a different default model:\n1. Run the benchmark harness (`benchmarkRunner.benchmarkModels` → `record_model_benchmark`) for the relevant task kinds.\n2. The candidate must reach `overall_score >= system_config[''ai_runtime''].eval_min_overall_score` and eval_status tested/approved.\n3. Only then activate. Missing eval result = FAIL (fail-closed), never a silent pass.',
    'testing_strategy'::expert_rule_category,
    v_partner_id, 'public',
    E'RULE: A change of the default/active model REQUIRES a green eval. Enforcement: set_active_ai_model_admin eval-before-migration gate (G4) blocks activation without eval_status tested/approved + ai_model_benchmarks overall_score >= ai_runtime.eval_min_overall_score. Never bypass by editing the registry directly; run the benchmark harness first.',
    ARRAY['anthropic-principles','governance','evals','source_type:external','data_sensitivity:public','retention_class:long_term','legal_basis:legitimate_interest'],
    'published', true, 1, now()
  ) ON CONFLICT (slug) DO UPDATE SET
    ai_instructions = EXCLUDED.ai_instructions,
    ai_context_tags = EXCLUDED.ai_context_tags,
    body_markdown = EXCLUDED.body_markdown,
    status = 'published',
    updated_at = now();

  -- 2. Countermeasure stack before a model downgrade.
  INSERT INTO expert_rules (
    slug, title, summary, body_markdown, category,
    author_partner_id, visibility,
    ai_instructions, ai_context_tags, status, is_verified, version, published_at
  ) VALUES (
    'anthropic-countermeasure-before-downgrade',
    'Countermeasures before downgrade',
    'Exhaust prompt caching, streaming, purpose routing and effort tuning before proposing a cheaper/weaker model.',
    E'# Countermeasures before downgrade\n\nWhen cost or latency pressure appears, the order is:\n1. **Prompt caching** (stable prefix + cache_control) — up to −90 % on cached input.\n2. **Streaming** — perceived latency, avoids timeouts.\n3. **Purpose routing** (`aisha_resolve_clow_backend`) — cheaper model only where the task kind allows it.\n4. **Effort/thinking tuning** — reasoning budget per purpose.\nOnly after these are exhausted may a downgrade of the default model be proposed — and then the eval-before-migration rule applies.',
    'performance_optimization'::expert_rule_category,
    v_partner_id, 'public',
    E'RULE: Before recommending a cheaper model, verify the countermeasure stack was applied: (a) prompt caching enabled for Anthropic-family calls (prepareAnthropicBody cache_control), (b) streaming for long outputs, (c) purpose-based routing via aisha_resolve_clow_backend, (d) reasoningEffort per purpose. Cost optimization = data (registry cached_input_price_per_m), not gut feeling.',
    ARRAY['anthropic-principles','cost','caching','streaming','routing','source_type:external','data_sensitivity:public','retention_class:long_term','legal_basis:legitimate_interest'],
    'published', true, 1, now()
  ) ON CONFLICT (slug) DO UPDATE SET
    ai_instructions = EXCLUDED.ai_instructions,
    ai_context_tags = EXCLUDED.ai_context_tags,
    body_markdown = EXCLUDED.body_markdown,
    status = 'published',
    updated_at = now();

  -- 3. Diagnose before swapping the model.
  INSERT INTO expert_rules (
    slug, title, summary, body_markdown, category,
    author_partner_id, visibility,
    ai_instructions, ai_context_tags, status, is_verified, version, published_at
  ) VALUES (
    'anthropic-diagnose-before-model-swap',
    'Diagnose before model swap',
    'On "the AI is not working": inspect the system prompt and recent failures before changing the model.',
    E'# Diagnose before model swap\n\n"The AI is not working" is a diagnostic trigger, not a migration trigger. Before proposing a different model:\n1. Read the actual system prompt / composed context of the failing runs.\n2. Review the last ~10 failures (ai_runs / trace events / Langfuse) for the real failure mode.\n3. Classify: prompt bug, context overflow, tool failure, retrieval miss — most regressions are NOT the model.\nOnly with a diagnosis in hand may a model change be proposed (and then eval-before-migration applies).',
    'ai_prompt_engineering'::expert_rule_category,
    v_partner_id, 'public',
    E'RULE: When a user reports degraded AI behavior, FIRST request/inspect the effective system prompt and the last ~10 failed runs (ai_runs, ai_trace_events, Langfuse) and name the failure mode. NEVER propose a model swap as the first remediation. A swap proposal must cite the diagnosis + pass the eval gate.',
    ARRAY['anthropic-principles','diagnostics','observability','source_type:external','data_sensitivity:public','retention_class:long_term','legal_basis:legitimate_interest'],
    'published', true, 1, now()
  ) ON CONFLICT (slug) DO UPDATE SET
    ai_instructions = EXCLUDED.ai_instructions,
    ai_context_tags = EXCLUDED.ai_context_tags,
    body_markdown = EXCLUDED.body_markdown,
    status = 'published',
    updated_at = now();

  -- 4. Context is a finite resource.
  INSERT INTO expert_rules (
    slug, title, summary, body_markdown, category,
    author_partner_id, visibility,
    ai_instructions, ai_context_tags, status, is_verified, version, published_at
  ) VALUES (
    'anthropic-context-as-finite-resource',
    'Context is a finite resource',
    'Surface tools and context progressively; compact above threshold; never ship everything at once.',
    E'# Context is a finite resource\n\nEvery token in the window competes with the answer:\n1. **Progressive tool disclosure** — send the tools the routed task needs (route-plan toolsAllowlist), not the full catalog.\n2. **Budgeted input** — respect the model context_window with headroom (ai_runtime.context_budget_headroom; 0.7 because chars/4 underestimates).\n3. **Compaction over truncation** — above compact_threshold summarize old turns (chat.history_compaction purpose), keep the recent tail verbatim.\n4. Long agent runs compact on the orchestrator node boundary, not just chat history.',
    'ai_prompt_engineering'::expert_rule_category,
    v_partner_id, 'public',
    E'RULE: Treat the context window as budgeted: apply route-plan toolsAllowlist narrowing (impl 01), enforce computeInputBudget with ai_runtime.context_budget_headroom, and compact history above ai_runtime.compact_threshold via the governed chat.history_compaction purpose. NULL context_window → parity behavior (no aggressive trimming).',
    ARRAY['anthropic-principles','context','compaction','tool-disclosure','source_type:external','data_sensitivity:public','retention_class:long_term','legal_basis:legitimate_interest'],
    'published', true, 1, now()
  ) ON CONFLICT (slug) DO UPDATE SET
    ai_instructions = EXCLUDED.ai_instructions,
    ai_context_tags = EXCLUDED.ai_context_tags,
    body_markdown = EXCLUDED.body_markdown,
    status = 'published',
    updated_at = now();

  -- 5. Safety as architecture: destructive actions pass a permission gate.
  INSERT INTO expert_rules (
    slug, title, summary, body_markdown, category,
    author_partner_id, visibility,
    ai_instructions, ai_context_tags, status, is_verified, version, published_at
  ) VALUES (
    'anthropic-safety-hook-on-destructive',
    'Safety hook on destructive actions',
    'Destructive tool actions must pass a permission gate/hook; outbound fetches go through the SSRF guard.',
    E'# Safety as architecture\n\nSafety is structural, not a prompt suggestion:\n1. Destructive tool actions (writes, deletes, deployments, spend) pass an explicit permission gate (agent-runner approval_required / permission modes).\n2. Every LLM-driven outbound fetch goes through the SSRF guard (`createSsrfGuard().safeFetch`) — no bare fetch in untrusted paths (static defense rule aisha-raw-fetch-outside-ssrf-guard).\n3. Retrieved external content is fenced as untrusted data at the prompt boundary before it reaches the model.',
    'security_practice'::expert_rule_category,
    v_partner_id, 'public',
    E'RULE: Never execute a destructive tool action without the permission gate (agent_runs.approval_required / runner permission mode). All web/untrusted fetches MUST use @aisha/security createSsrfGuard().safeFetch (enforced by static defense rule aisha-raw-fetch-outside-ssrf-guard). KB/memory/web content is wrapped as untrusted at the prompt boundary.',
    ARRAY['anthropic-principles','safety','ssrf','permission-gates','source_type:external','data_sensitivity:public','retention_class:long_term','legal_basis:legitimate_interest'],
    'published', true, 1, now()
  ) ON CONFLICT (slug) DO UPDATE SET
    ai_instructions = EXCLUDED.ai_instructions,
    ai_context_tags = EXCLUDED.ai_context_tags,
    body_markdown = EXCLUDED.body_markdown,
    status = 'published',
    updated_at = now();

  -- 6. Typed output for machine-consumed results.
  INSERT INTO expert_rules (
    slug, title, summary, body_markdown, category,
    author_partner_id, visibility,
    ai_instructions, ai_context_tags, status, is_verified, version, published_at
  ) VALUES (
    'anthropic-typed-output-for-pipelines',
    'Typed output for pipelines',
    'Where a system consumes the output, demand structured output (schema/jsonMode) — never parse prose.',
    E'# Typed output for pipelines\n\nWhen the consumer of an LLM output is code (judges, extractors, safety scans, routers):\n1. Request structured output — jsonMode at minimum, schema-grammar (output_config) where the provider supports it (provider_metadata.structured_output).\n2. Degrade gracefully: model without structured support → jsonMode → validated parse; never silent prose parsing.\n3. Structured output and citations are mutually exclusive per call — pick per purpose.',
    'api_design'::expert_rule_category,
    v_partner_id, 'public',
    E'RULE: Any LLM call whose output is consumed by code MUST set jsonMode/structured output (ChatRequest.jsonMode; grammar via provider_metadata.structured_output where supported). Parsing free prose in a pipeline is a defect. Structured output must not be combined with citations in one call.',
    ARRAY['anthropic-principles','output','structured-output','source_type:external','data_sensitivity:public','retention_class:long_term','legal_basis:legitimate_interest'],
    'published', true, 1, now()
  ) ON CONFLICT (slug) DO UPDATE SET
    ai_instructions = EXCLUDED.ai_instructions,
    ai_context_tags = EXCLUDED.ai_context_tags,
    body_markdown = EXCLUDED.body_markdown,
    status = 'published',
    updated_at = now();

  RAISE NOTICE 'Anthropic operating principles seeded/refreshed (6 governed expert_rules).';
END $$;
