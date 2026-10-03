-- ============================================================================
-- auth_provider_registry — declarative catalog of external identity providers.
--
-- The materialization target for plugin_catalog kind='auth_provider' (the kind
-- existed since the plugin control plane, but had NO loader — a manifest
-- validated, submitted, and then reached nothing; measured 2026-07-26, see
-- expert_rule declared-extension-must-reach-the-resolver).
--
-- A row DECLARES an IdP; it never performs auth itself. The consumer is the
-- realm reconciler: get_enabled_auth_providers() is read by the Keycloak
-- admin-API sync (the same path that provisions the Apple IdP today) which
-- converges keycloak identity providers onto this declaration. Secrets NEVER
-- live here — client_secret_env_var names the env var, mirroring
-- ai_provider_registry.auth_env_var.
--
-- §19.4 per-instance scoping: NULL scoped_to_instance_id = base/global
-- (every instance may enable it); non-NULL = that instance only.
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.auth_provider_registry (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Stable identifier; doubles as the Keycloak IdP alias the reconciler manages.
  slug text NOT NULL UNIQUE,
  display_name text NOT NULL,

  -- Protocol controls which reconciler template applies.
  protocol text NOT NULL CHECK (protocol IN ('oidc', 'oauth2', 'saml', 'ldap')),

  -- Protocol endpoints/identity (no secrets).
  issuer_url text,
  client_id text,
  client_secret_env_var text,          -- env var NAME holding the secret (NEVER the secret)

  -- Extra non-secret protocol config (scopes, claim mappings, button hints).
  config jsonb NOT NULL DEFAULT '{}'::jsonb,

  -- Ordering on the login surface; lower sorts first.
  priority int NOT NULL DEFAULT 100,

  is_enabled boolean NOT NULL DEFAULT false,

  -- §19.4 per-instance scoping (same contract as ai_provider_registry).
  scoped_to_instance_id uuid,

  -- Provenance: NULL = operator-declared; non-NULL = materialized from an
  -- approved marketplace plugin. Ownership guard — materialize_auth_provider
  -- only updates a row it already owns, so a plugin can never overwrite an
  -- operator-declared or another plugin's provider.
  source_plugin_id uuid REFERENCES public.plugin_catalog(id) ON DELETE SET NULL,

  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.auth_provider_registry ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE public.auth_provider_registry IS
  'Declarative IdP catalog. Materialization target for plugin kind=auth_provider; consumed by the Keycloak admin-API reconciler via get_enabled_auth_providers(). Secrets live in env (client_secret_env_var is a NAME), never here.';
