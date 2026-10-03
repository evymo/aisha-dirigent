-- ============================================================================
-- Source of Truth: github_app_installations
-- Popis: Registry GitHub App instalací navázaných na Evymo partnery.
--        Každá instalace = 1 GitHub org/user s přidělenými repo.
--        Installation tokens se cachují v edge function, ne v DB.
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.github_app_installations (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  installation_id bigint NOT NULL UNIQUE,           -- GitHub installation ID (immutable)
  account_login   text NOT NULL,                     -- GitHub org/user login
  account_type    text NOT NULL                      -- 'Organization' | 'User'
                  CHECK (account_type IN ('Organization', 'User')),
  partner_id      uuid                               -- FK → partner_profiles (NULL until linked)
                  REFERENCES partner_profiles(id) ON DELETE SET NULL,
  permissions     jsonb NOT NULL DEFAULT '{}'::jsonb, -- granted permissions snapshot
  repository_selection text NOT NULL DEFAULT 'selected'
                  CHECK (repository_selection IN ('all', 'selected')),
  suspended_at    timestamptz,                        -- NULL = active, set = suspended/uninstalled
  installed_by    uuid                                -- Evymo user who initiated install (nullable)
                  REFERENCES profiles(id) ON DELETE SET NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

-- Comments
COMMENT ON TABLE public.github_app_installations IS 'Registry GitHub App instalací – 1 řádek = 1 GitHub org/user';
COMMENT ON COLUMN public.github_app_installations.installation_id IS 'Neměnný GitHub installation ID, klíč pro token exchange';
COMMENT ON COLUMN public.github_app_installations.partner_id IS 'Napojení na Evymo partnera – NULL dokud staff nepřiřadí';
COMMENT ON COLUMN public.github_app_installations.permissions IS 'Snapshot oprávnění z installation webhooku (auditable)';
COMMENT ON COLUMN public.github_app_installations.suspended_at IS 'Soft-delete: nastaveno při uninstall/suspend, NULL = aktivní';

ALTER TABLE public.github_app_installations ENABLE ROW LEVEL SECURITY;
