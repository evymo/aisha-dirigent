-- Table: story_contexts

CREATE TABLE IF NOT EXISTS public.story_contexts (
  story_id uuid NOT NULL,
  ruleset_id uuid,
  mcp_endpoint text,
  mcp_token_id uuid,
  build_config jsonb DEFAULT '{}'::jsonb NOT NULL,
  env_hints jsonb DEFAULT '{}'::jsonb NOT NULL,
  portable_config jsonb DEFAULT '{}'::jsonb NOT NULL,
  local_overlay jsonb DEFAULT '{}'::jsonb NOT NULL,
  active_instance_id uuid,
  active_bundle_version integer DEFAULT 0,
  updated_at timestamp with time zone DEFAULT now() NOT NULL,
  PRIMARY KEY (story_id),
  CONSTRAINT story_contexts_active_instance_fkey
    FOREIGN KEY (active_instance_id) REFERENCES story_instances(id) ON DELETE SET NULL
);

ALTER TABLE public.story_contexts ENABLE ROW LEVEL SECURITY;
