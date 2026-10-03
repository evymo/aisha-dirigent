-- ============================================================================
-- Source of Truth: materialize_data_source
-- Purpose: Turn an APPROVED plugin (kind='data_source', source_spec) into an
--          agent_knowledge_sources row — the ingest spine's source registry.
--          This is the missing verb of the umbrella model: the machinery
--          (source-broker plugin host, IDataSource lifecycle, story bindings)
--          exists; what was missing was the registration that makes a
--          connector a first-class, resolver-visible source.
--
-- The row lands is_active=false BY CONSTRUCTION: agent_knowledge_sources'
-- activation guard requires the full 4D classification (data_sensitivity,
-- legal_basis, owner, retention — Source Onboarding Contract) which is
-- instance DATA, not plugin code. The plugin declares WHAT it can read
-- (adapter entry, namespace, default config); the instance classifies and
-- binds credentials, then activates. Fail-closed onboarding is preserved.
--
-- The adapter itself is loaded by svc-source-broker's plugin host from the
-- entry path recorded here (config.adapter_entry) — in-process IDataSource,
-- deliberately NOT the https-only compute sandbox (see plugin-host.ts).
-- Idempotent; ownership-guarded; SECURITY DEFINER, service_role only.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.materialize_data_source(p_plugin_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_pc          record;
  v_spec        jsonb;
  v_source_slug text;
  v_namespace   text;
  v_config      jsonb;
  v_registry_id uuid;
  v_audit_user  uuid;
BEGIN
  SELECT id, slug, name, description, source_spec, kind, author_partner_id
    INTO v_pc
    FROM public.plugin_catalog
   WHERE id = p_plugin_id;

  IF v_pc.id IS NULL THEN
    RAISE EXCEPTION 'Plugin not found: %', p_plugin_id USING ERRCODE = 'P0002';
  END IF;
  IF v_pc.kind <> 'data_source' THEN
    RAISE EXCEPTION 'Plugin % is not a data_source', p_plugin_id USING ERRCODE = 'P0002';
  END IF;

  v_spec := v_pc.source_spec;
  IF v_spec IS NULL THEN
    RETURN jsonb_build_object('skipped', 'no source_spec', 'plugin_slug', v_pc.slug);
  END IF;

  v_source_slug := COALESCE(v_spec->>'source_slug', v_pc.slug);
  v_namespace   := v_spec->>'namespace';
  IF v_namespace IS NULL THEN
    RAISE EXCEPTION 'source_spec.namespace required for plugin %', v_pc.slug
      USING ERRCODE = '22023';
  END IF;

  -- Declaration config: adapter entry + declared defaults. The 4D
  -- classification keys are deliberately NOT set here — they are instance
  -- data; their absence is exactly what keeps is_active=false enforceable.
  v_config := COALESCE(v_spec->'default_config', '{}'::jsonb)
    || jsonb_build_object(
         'adapter_entry', v_spec->>'adapter_entry',
         'declared_by_plugin', v_pc.slug
       );

  INSERT INTO public.agent_knowledge_sources (
    source_slug, namespace, is_active, config, source_plugin_id
  ) VALUES (
    v_source_slug,
    v_namespace,
    false,  -- activation requires the instance's 4D classification (guard)
    v_config,
    p_plugin_id
  )
  ON CONFLICT (source_slug) DO UPDATE SET
    namespace       = EXCLUDED.namespace,
    -- Merge order matters: existing config (instance classification,
    -- credentials binding refs) WINS over re-declared defaults, so a
    -- re-approval refreshes adapter_entry/defaults without clobbering the
    -- instance's onboarding work. is_active deliberately untouched.
    config          = EXCLUDED.config || public.agent_knowledge_sources.config,
    source_plugin_id = p_plugin_id,
    updated_at      = now()
  WHERE public.agent_knowledge_sources.source_plugin_id = p_plugin_id
  RETURNING id INTO v_registry_id;

  IF v_registry_id IS NULL THEN
    RAISE EXCEPTION 'Source slug % collides with a seeded/other source — refusing to overwrite', v_source_slug
      USING ERRCODE = '42501';
  END IF;

  v_audit_user := auth.uid();
  IF v_audit_user IS NULL AND v_pc.author_partner_id IS NOT NULL THEN
    SELECT pp.user_id INTO v_audit_user
      FROM public.partner_profiles pp WHERE pp.id = v_pc.author_partner_id;
  END IF;
  INSERT INTO public.audit_journal (user_id, action, metadata)
  VALUES (v_audit_user, 'DATA_SOURCE_MATERIALIZED', jsonb_build_object(
    'area', 'marketplace', 'severity', 'info',
    'plugin_id', p_plugin_id, 'source_slug', v_source_slug,
    'namespace', v_namespace, 'registry_id', v_registry_id,
    'active', false
  ));

  RETURN jsonb_build_object('source_slug', v_source_slug, 'registry_id', v_registry_id, 'active', false);
END;
$$;

COMMENT ON FUNCTION public.materialize_data_source(uuid) IS
  'Materialize an approved data_source plugin into agent_knowledge_sources (inactive until the instance completes 4D classification — fail-closed onboarding). Idempotent; ownership-guarded; service_role only.';

REVOKE ALL ON FUNCTION public.materialize_data_source(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.materialize_data_source(uuid) TO service_role;
