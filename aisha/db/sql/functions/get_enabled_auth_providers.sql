-- ============================================================================
-- Source of Truth: get_enabled_auth_providers
-- Purpose: THE consumer seam of auth_provider_registry. Two readers:
--   1. the login surface (anonymous!) — renders external-IdP buttons; gets the
--      public shape only (no env var names, no metadata),
--   2. the Keycloak admin-API reconciler (service_role) — reads the table
--      directly for the full row incl. client_secret_env_var.
-- This RPC serves reader 1: enabled rows, instance-scoped, ordered by priority.
-- SECURITY DEFINER so anon can enumerate ONLY the deliberate public shape
-- (direct table read stays authenticated+scoped via RLS).
-- ============================================================================

CREATE OR REPLACE FUNCTION public.get_enabled_auth_providers()
RETURNS TABLE (
  slug         text,
  display_name text,
  protocol     text,
  issuer_url   text,
  priority     int,
  button       jsonb   -- display hints subset of config (icon, label overrides)
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT r.slug, r.display_name, r.protocol, r.issuer_url, r.priority,
         COALESCE(r.config->'button', '{}'::jsonb) AS button
    FROM public.auth_provider_registry r
   WHERE r.is_enabled
     AND (
       r.scoped_to_instance_id IS NULL
       OR r.scoped_to_instance_id = NULLIF(current_setting('aisha.instance_id', true), '')::uuid
     )
   ORDER BY r.priority, r.slug;
$$;

COMMENT ON FUNCTION public.get_enabled_auth_providers() IS
  'Login-surface enumeration of enabled IdPs (public shape only — no secrets, no env var names). The Keycloak reconciler reads the table directly as service_role.';

REVOKE ALL ON FUNCTION public.get_enabled_auth_providers() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_enabled_auth_providers() TO anon, authenticated, service_role;
