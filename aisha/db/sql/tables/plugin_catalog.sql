-- Table: plugin_catalog

CREATE TABLE IF NOT EXISTS public.plugin_catalog (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  slug text NOT NULL,
  name text,
  description text,
  author text,
  kind public.plugin_kind NOT NULL,
  trust_tier public.plugin_trust_tier DEFAULT 'external'::public.plugin_trust_tier NOT NULL,
  status public.plugin_status DEFAULT 'submitted'::public.plugin_status NOT NULL,
  capabilities jsonb DEFAULT '[]'::jsonb NOT NULL,
  config_schema jsonb,
  sandbox_policy jsonb,
  lifecycle jsonb,
  -- Run-as-story template for kind='agent' (declarative agents). Carries
  -- rule_slugs + knowledge_items + story defaults; consumed by
  -- install_agent_as_story to mint a consumer-owned story. NULL for non-agents
  -- and for executable/call-mode agents (Phase 2). Kind-specific, same posture
  -- as sandbox_policy living on this shared catalog row.
  agent_spec jsonb,
  -- Per-kind materialization specs, symmetric to agent_spec: each kind that
  -- materializes into a runtime registry carries its declaration in its own
  -- column, and the matching materialize_* function is the ONLY reader. A kind
  -- with a NULL spec is skipped with a note (honest degradation), never guessed
  -- from config_schema — the spec IS the contract, config_schema stays the
  -- per-install parameter form.
  provider_spec jsonb,   -- kind=backend_provider → materialize_backend_provider → ai_provider_registry
  node_spec jsonb,       -- kind=automation_node  → materialize_automation_node  → custom_node_registry
  auth_spec jsonb,       -- kind=auth_provider    → materialize_auth_provider    → auth_provider_registry
  tracking_spec jsonb,   -- kind=web_tracking     → materialize_web_tracking     → web_tracking_registry
  source_spec jsonb,     -- kind=data_source      → materialize_data_source      → agent_knowledge_sources
  author_partner_id uuid,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL,
  PRIMARY KEY (id),
  CONSTRAINT plugin_catalog_slug_key UNIQUE (slug)
);

ALTER TABLE public.plugin_catalog ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE public.plugin_catalog IS 'Registry of all plugins assimilated by AISHA.';
COMMENT ON COLUMN public.plugin_catalog.agent_spec IS 'kind=agent declarative spec. Run-as-story template (rule_slugs, knowledge_items, story defaults) consumed by install_agent_as_story; runtime registry keys (purpose, default_model [router KEY e.g. balanced/fast/maxQuality, not a raw provider id], allowed_tools, denied_tools, model_overrides, max_loops, safety_level, autonomy_level, context_profile) consumed by materialize_agent_runtime → agent_catalog.';
