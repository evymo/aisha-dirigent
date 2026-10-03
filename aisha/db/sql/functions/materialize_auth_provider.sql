-- ============================================================================
-- Source of Truth: materialize_auth_provider
-- Purpose: Turn an APPROVED plugin (kind='auth_provider', auth_spec) into an
--          auth_provider_registry row the Keycloak admin-API reconciler reads.
--
-- DELIBERATE ASYMMETRY vs materialize_backend_provider: the row lands with
-- is_enabled=false. An identity provider is an INBOUND TRUST boundary — who may
-- log in — and a marketplace approval must not widen it by itself; the operator
-- enables the row (and thereby the reconciler creates the Keycloak IdP). A
-- backend provider is an outbound egress choice guarded by health+admission,
-- so it may enable on approval. Same reasoning applies to web_tracking
-- (privacy boundary).
--
-- Secrets: auth_spec carries client_secret_env_var — the env var NAME. The
-- secret value never enters the DB.
-- Idempotent; ownership-guarded; SECURITY DEFINER, service_role only.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.materialize_auth_provider(p_plugin_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_pc          record;
  v_spec        jsonb;
  v_protocol    text;
  v_scope       uuid;
  v_registry_id uuid;
  v_audit_user  uuid;
BEGIN
  SELECT id, slug, name, description, auth_spec, kind, author_partner_id
    INTO v_pc
    FROM public.plugin_catalog
   WHERE id = p_plugin_id;

  IF v_pc.id IS NULL THEN
    RAISE EXCEPTION 'Plugin not found: %', p_plugin_id USING ERRCODE = 'P0002';
  END IF;
  IF v_pc.kind <> 'auth_provider' THEN
    RAISE EXCEPTION 'Plugin % is not an auth_provider', p_plugin_id USING ERRCODE = 'P0002';
  END IF;

  v_spec := v_pc.auth_spec;
  IF v_spec IS NULL THEN
    RETURN jsonb_build_object('skipped', 'no auth_spec', 'plugin_slug', v_pc.slug);
  END IF;

  v_protocol := v_spec->>'protocol';
  IF v_protocol IS NULL OR v_protocol NOT IN ('oidc','oauth2','saml','ldap') THEN
    RAISE EXCEPTION 'auth_spec.protocol invalid for plugin %: %', v_pc.slug, v_protocol
      USING ERRCODE = '22023';
  END IF;

  v_scope := CASE
    WHEN COALESCE((v_spec->>'global')::boolean, false) THEN NULL
    ELSE NULLIF(current_setting('aisha.instance_id', true), '')::uuid
  END;

  INSERT INTO public.auth_provider_registry (
    slug, display_name, protocol, issuer_url, client_id, client_secret_env_var,
    config, priority, is_enabled, scoped_to_instance_id, source_plugin_id, metadata
  ) VALUES (
    v_pc.slug,
    COALESCE(v_spec->>'display_name', v_pc.name, 'IdP: ' || v_pc.slug),
    v_protocol,
    v_spec->>'issuer_url',
    v_spec->>'client_id',
    v_spec->>'client_secret_env_var',
    COALESCE(v_spec->'config', '{}'::jsonb),
    COALESCE((v_spec->>'priority')::int, 100),
    false,  -- trust boundary: operator enables, approval only declares
    v_scope,
    p_plugin_id,
    COALESCE(v_spec->'metadata', '{}'::jsonb)
  )
  ON CONFLICT (slug) DO UPDATE SET
    display_name          = EXCLUDED.display_name,
    protocol              = EXCLUDED.protocol,
    issuer_url            = EXCLUDED.issuer_url,
    client_id             = EXCLUDED.client_id,
    client_secret_env_var = EXCLUDED.client_secret_env_var,
    config                = EXCLUDED.config,
    priority              = EXCLUDED.priority,
    -- is_enabled deliberately NOT touched: re-approval never re-arms a
    -- provider the operator disabled (kill-switch survives re-materialization,
    -- same posture as the agent bindings' soft-disable survival).
    scoped_to_instance_id = EXCLUDED.scoped_to_instance_id,
    source_plugin_id      = p_plugin_id,
    metadata              = EXCLUDED.metadata,
    updated_at            = now()
  WHERE public.auth_provider_registry.source_plugin_id = p_plugin_id
  RETURNING id INTO v_registry_id;

  IF v_registry_id IS NULL THEN
    RAISE EXCEPTION 'IdP slug % collides with an operator-declared/other provider — refusing to overwrite', v_pc.slug
      USING ERRCODE = '42501';
  END IF;

  v_audit_user := auth.uid();
  IF v_audit_user IS NULL AND v_pc.author_partner_id IS NOT NULL THEN
    SELECT pp.user_id INTO v_audit_user
      FROM public.partner_profiles pp WHERE pp.id = v_pc.author_partner_id;
  END IF;
  INSERT INTO public.audit_journal (user_id, action, metadata)
  VALUES (v_audit_user, 'AUTH_PROVIDER_MATERIALIZED', jsonb_build_object(
    'area', 'marketplace', 'severity', 'info',
    'plugin_id', p_plugin_id, 'idp_slug', v_pc.slug,
    'registry_id', v_registry_id, 'protocol', v_protocol,
    'enabled', false
  ));

  RETURN jsonb_build_object('idp_slug', v_pc.slug, 'registry_id', v_registry_id, 'enabled', false);
END;
$$;

COMMENT ON FUNCTION public.materialize_auth_provider(uuid) IS
  'Materialize an approved auth_provider plugin into auth_provider_registry, DISABLED (trust boundary — operator enables). Idempotent; ownership-guarded; service_role only.';

REVOKE ALL ON FUNCTION public.materialize_auth_provider(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.materialize_auth_provider(uuid) TO service_role;
