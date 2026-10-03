-- Table: agent_catalog

CREATE TABLE IF NOT EXISTS public.agent_catalog (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  slug text NOT NULL,
  display_name text NOT NULL,
  purpose text NOT NULL,
  default_model text NOT NULL,
  model_overrides jsonb DEFAULT '{}'::jsonb NOT NULL,
  allowed_tools text[] DEFAULT '{}'::text[] NOT NULL,
  denied_tools text[] DEFAULT '{}'::text[] NOT NULL,
  default_context_profile text DEFAULT 'repo_plus_rules'::text NOT NULL,
  max_loops integer DEFAULT 3 NOT NULL,
  safety_level text DEFAULT 'standard'::text NOT NULL,
  is_active boolean DEFAULT true NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL,
  autonomy_level text DEFAULT 'semi'::text,
  -- Provenance for marketplace-materialized agents: the plugin_catalog row this
  -- runtime entry was materialized from (NULL for built-in/seeded system agents).
  -- Used by materialize_agent_runtime (ON CONFLICT guard so a marketplace agent
  -- cannot hijack a system slug) and disable_agent_runtime (de-provision key).
  source_plugin_id uuid REFERENCES public.plugin_catalog(id) ON DELETE SET NULL,
  PRIMARY KEY (id)
);

ALTER TABLE public.agent_catalog ENABLE ROW LEVEL SECURITY;

COMMENT ON COLUMN public.agent_catalog.source_plugin_id IS 'plugin_catalog.id this runtime agent was materialized from (NULL = built-in/seed agent).';
