-- ============================================================================
-- Source of Truth: github_app_repositories
-- Popis: Cache repozitářů dostupných přes GitHub App instalaci.
--        Aktualizuje se z installation_repositories webhooků.
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.github_app_repositories (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  installation_id bigint NOT NULL
                  REFERENCES github_app_installations(installation_id) ON DELETE CASCADE,
  repo_id         bigint NOT NULL,                    -- GitHub repository ID
  repo_full_name  text NOT NULL,                      -- 'org/repo-name'
  is_private      boolean NOT NULL DEFAULT true,
  default_branch  text NOT NULL DEFAULT 'main',
  is_active       boolean NOT NULL DEFAULT true,      -- false = removed from installation
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (installation_id, repo_id)
);

-- Comments
COMMENT ON TABLE public.github_app_repositories IS 'Cache GitHub repozitářů dostupných přes instalaci';
COMMENT ON COLUMN public.github_app_repositories.repo_full_name IS 'org/repo-name – slouží pro reverse lookup z webhooků';

ALTER TABLE public.github_app_repositories ENABLE ROW LEVEL SECURITY;
