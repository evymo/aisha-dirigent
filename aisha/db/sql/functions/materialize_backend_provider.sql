-- ============================================================================
-- Source of Truth: materialize_backend_provider
-- Purpose: Turn an APPROVED plugin (kind='backend_provider', provider_spec)
--          into a resolver-visible ai_provider_registry row. After this,
--          aisha_resolve_clow_backend can route capability-needing work to it —
--          the declared capability reaches the far end of the spine instead of
--          dying as a catalog row (the pre-2026-07-26 state: 6 kinds declared,
--          1 materializer).
--
-- Called from materialize_plugin (the kind dispatcher) inside the approval txn.
-- Secrets: provider_spec carries auth_env_var — the NAME of the env var, never
-- a secret value (same contract as operator-declared providers).
-- Scoping: by default the row is scoped to the current instance
-- (aisha.instance_id); provider_spec.global=true opts into a base/global row.
-- Idempotent: re-approval converges on one row. Ownership guard: the ON
-- CONFLICT update only touches a row this plugin already owns — a slug
-- collision with a built-in or another plugin's provider REFUSES loudly.
-- Security: SECURITY DEFINER, service_role only.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.materialize_backend_provider(p_plugin_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_pc          record;
  v_spec        jsonb;
  v_backend     text;
  v_scope       uuid;
  v_registry_id uuid;
  v_audit_user  uuid;
BEGIN
  SELECT id, slug, name, description, provider_spec, kind, author_partner_id
    INTO v_pc
    FROM public.plugin_catalog
   WHERE id = p_plugin_id;

  IF v_pc.id IS NULL THEN
    RAISE EXCEPTION 'Plugin not found: %', p_plugin_id USING ERRCODE = 'P0002';
  END IF;
  IF v_pc.kind <> 'backend_provider' THEN
    RAISE EXCEPTION 'Plugin % is not a backend_provider', p_plugin_id USING ERRCODE = 'P0002';
  END IF;

  v_spec := v_pc.provider_spec;
  -- Honest degradation, never guessing: a provider with no spec is skipped with
  -- a note. We deliberately do NOT reverse-engineer endpoints out of
  -- config_schema — the spec IS the materialization contract.
  IF v_spec IS NULL THEN
    RETURN jsonb_build_object('skipped', 'no provider_spec', 'plugin_slug', v_pc.slug);
  END IF;

  -- backend_kind has no safe default (it selects the dispatch path); a wrong
  -- value would silently route calls down the wrong client. Fail loud instead.
  v_backend := v_spec->>'backend_kind';
  IF v_backend IS NULL OR v_backend NOT IN ('direct_cloud','llm_gateway','local_ollama','local_vllm','mcp_server') THEN
    RAISE EXCEPTION 'provider_spec.backend_kind invalid for plugin %: %', v_pc.slug, v_backend
      USING ERRCODE = '22023';
  END IF;

  -- Default = scoped to the current instance (small blast radius); an explicit
  -- "global": true publishes a base row visible to every instance.
  v_scope := CASE
    WHEN COALESCE((v_spec->>'global')::boolean, false) THEN NULL
    ELSE NULLIF(current_setting('aisha.instance_id', true), '')::uuid
  END;

  INSERT INTO public.ai_provider_registry (
    slug, display_name, backend_kind, endpoint_url, health_url,
    auth_kind, auth_env_var,
    supports_chat, supports_tool_use, supports_vision, supports_batch, supports_streaming,
    cost_class, is_enabled, scoped_to_instance_id, source_plugin_id, metadata
  ) VALUES (
    v_pc.slug,
    COALESCE(v_spec->>'display_name', v_pc.name, 'Provider: ' || v_pc.slug),
    v_backend,
    v_spec->>'endpoint_url',
    v_spec->>'health_url',
    COALESCE(v_spec->>'auth_kind', 'bearer'),
    v_spec->>'auth_env_var',
    COALESCE((v_spec->>'supports_chat')::boolean, true),
    COALESCE((v_spec->>'supports_tool_use')::boolean, false),
    COALESCE((v_spec->>'supports_vision')::boolean, false),
    COALESCE((v_spec->>'supports_batch')::boolean, false),
    COALESCE((v_spec->>'supports_streaming')::boolean, true),
    COALESCE(v_spec->>'cost_class', 'standard'),
    true,
    v_scope,
    p_plugin_id,
    COALESCE(v_spec->'metadata', '{}'::jsonb)
  )
  ON CONFLICT (slug) DO UPDATE SET
    display_name       = EXCLUDED.display_name,
    backend_kind       = EXCLUDED.backend_kind,
    endpoint_url       = EXCLUDED.endpoint_url,
    health_url         = EXCLUDED.health_url,
    auth_kind          = EXCLUDED.auth_kind,
    auth_env_var       = EXCLUDED.auth_env_var,
    supports_chat      = EXCLUDED.supports_chat,
    supports_tool_use  = EXCLUDED.supports_tool_use,
    supports_vision    = EXCLUDED.supports_vision,
    supports_batch     = EXCLUDED.supports_batch,
    supports_streaming = EXCLUDED.supports_streaming,
    cost_class         = EXCLUDED.cost_class,
    is_enabled         = true,
    scoped_to_instance_id = EXCLUDED.scoped_to_instance_id,
    source_plugin_id   = p_plugin_id,
    metadata           = EXCLUDED.metadata,
    updated_at         = now()
  WHERE public.ai_provider_registry.source_plugin_id = p_plugin_id
  RETURNING id INTO v_registry_id;

  IF v_registry_id IS NULL THEN
    RAISE EXCEPTION 'Provider slug % collides with a built-in/other provider — refusing to overwrite', v_pc.slug
      USING ERRCODE = '42501';
  END IF;

  v_audit_user := auth.uid();
  IF v_audit_user IS NULL AND v_pc.author_partner_id IS NOT NULL THEN
    SELECT pp.user_id INTO v_audit_user
      FROM public.partner_profiles pp WHERE pp.id = v_pc.author_partner_id;
  END IF;
  INSERT INTO public.audit_journal (user_id, action, metadata)
  VALUES (v_audit_user, 'BACKEND_PROVIDER_MATERIALIZED', jsonb_build_object(
    'area', 'marketplace', 'severity', 'info',
    'plugin_id', p_plugin_id, 'provider_slug', v_pc.slug,
    'registry_id', v_registry_id, 'backend_kind', v_backend,
    'scoped_to_instance_id', v_scope
  ));

  RETURN jsonb_build_object('provider_slug', v_pc.slug, 'registry_id', v_registry_id);
END;
$$;

COMMENT ON FUNCTION public.materialize_backend_provider(uuid) IS
  'Materialize an approved backend_provider plugin into a resolver-visible ai_provider_registry row. Idempotent; ownership-guarded; service_role only.';

REVOKE ALL ON FUNCTION public.materialize_backend_provider(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.materialize_backend_provider(uuid) TO service_role;
