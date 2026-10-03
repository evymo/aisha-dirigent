-- Table: story_environments
-- Per-story deploy environment (dev/staging/prod) with its provider + deploy
-- status. The environment / deploy_provider / deploy_status columns model a FIXED
-- vocabulary and are constrained by CHECK (... IN (...)) so the DB rejects free-text
-- garbage at the boundary (Validate-All-Input + fail-loud); story_id is FK-bound to
-- the story spine.

CREATE TABLE IF NOT EXISTS public.story_environments (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  story_id uuid NOT NULL,
  environment text NOT NULL
    CHECK (environment IN ('dev', 'staging', 'production', 'prod', 'preview', 'local')),
  url text,
  branch text,
  deploy_provider text NOT NULL DEFAULT 'coolify'::text
    CHECK (deploy_provider IN ('coolify', 'vercel', 'netlify', 'fly', 'render', 'docker', 'manual', 'none')),
  deploy_id text,
  deploy_status text NOT NULL DEFAULT 'pending'::text
    CHECK (deploy_status IN ('pending', 'queued', 'in_progress', 'running', 'building', 'deployed', 'success', 'failed', 'error', 'cancelled', 'rolled_back')),
  last_deployed_at timestamp with time zone,
  config jsonb DEFAULT '{}'::jsonb,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL,
  PRIMARY KEY (id),
  CONSTRAINT story_environments_story_id_fkey
    FOREIGN KEY (story_id) REFERENCES public.partner_stories(id) ON DELETE CASCADE
);

ALTER TABLE public.story_environments ENABLE ROW LEVEL SECURITY;
