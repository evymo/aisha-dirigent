-- Table: context_profiles

CREATE TABLE IF NOT EXISTS public.context_profiles (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  slug text NOT NULL,
  display_name text NOT NULL,
  description text,
  layers jsonb NOT NULL,
  token_budget integer DEFAULT 8000 NOT NULL,
  priority_order text[] DEFAULT ARRAY['ruleset'::text, 'project_context'::text, 'kb_retrieval'::text, 'memory'::text] NOT NULL,
  is_active boolean DEFAULT true NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  -- Step 7.3 (20260520050000): per-profile multi-hop graph traversal config
  -- (used by fn_get_run_graph_context for the explainability panel).
  graph_depth integer DEFAULT 2 NOT NULL
    CHECK (graph_depth BETWEEN 1 AND 4),
  graph_per_seed integer DEFAULT 10 NOT NULL
    CHECK (graph_per_seed BETWEEN 1 AND 50),
  -- Phase 12 WP 4.3: per-profile Stage-2 rerank provider selection.
  -- NULL = no rerank (legacy behaviour, identical to today).
  -- 'vllm_local'    = call svc-mcp-knowledge → vllm-reranker container
  --                   (bge-reranker-v2-m3, on-prem, no egress, free)
  -- 'cohere'        = paid Cohere rerank API (premium tier customers only)
  -- 'capability_resolver' = let aisha_resolve_clow_backend pick dynamically
  --                         per current provider health (recommended once
  --                         multiple rerank providers are healthy)
  rerank_provider text
    CHECK (rerank_provider IS NULL OR rerank_provider IN (
      'vllm_local',
      'cohere',
      'capability_resolver'
    )),
  -- Phase 12 WP 4.1 (migration 20260518250000_critic_loop.sql):
  -- per-profile critic-loop config. The state machine in
  -- services/svc-ai-chat/src/lib/criticLoop.ts reads these via
  -- fn_get_critic_config(profile_slug) on every chat turn. SoT was
  -- previously missing these 4 columns even though the migration
  -- added them; locked here by wp-4-1-critic-loop.gate.test.ts.
  critic_enabled boolean NOT NULL DEFAULT false,
  critic_threshold numeric(4, 3) NOT NULL DEFAULT 0.85
    CHECK (critic_threshold BETWEEN 0 AND 1),
  critic_max_iterations smallint NOT NULL DEFAULT 3
    CHECK (critic_max_iterations BETWEEN 1 AND 10),
  critic_strategies text[] NOT NULL DEFAULT
    ARRAY['expand_tags', 'broaden_threshold']::text[],
  PRIMARY KEY (id)
);

ALTER TABLE public.context_profiles ENABLE ROW LEVEL SECURITY;

-- Columns added by later migrations (back-port reconciliation):
ALTER TABLE public.context_profiles ADD COLUMN IF NOT EXISTS embedding_model_pref text DEFAULT 'v1'::text;
ALTER TABLE public.context_profiles ADD COLUMN IF NOT EXISTS multimodal_enabled boolean NOT NULL DEFAULT false;
ALTER TABLE public.context_profiles ADD COLUMN IF NOT EXISTS data_scope_rule jsonb NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE public.context_profiles ADD COLUMN IF NOT EXISTS tier_required text;
ALTER TABLE public.context_profiles ADD COLUMN IF NOT EXISTS permission_required text;
