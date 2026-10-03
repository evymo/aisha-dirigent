-- ============================================================================
-- Source of Truth: materialize_web_tracking
-- Purpose: Turn an APPROVED plugin (kind='web_tracking', tracking_spec) into a
--          web_tracking_registry row the web surface reads via
--          get_active_web_tracking().
--
-- Lands DISABLED (privacy boundary — same reasoning as materialize_auth_provider:
-- a marketplace approval must not by itself start measuring visitors; the
-- operator enables). Loading is additionally consent-gated per visitor by the
-- consumer (consent_category), so enablement alone still respects consent.
-- Idempotent; ownership-guarded; SECURITY DEFINER, service_role only.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.materialize_web_tracking(p_plugin_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_pc          record;
  v_spec        jsonb;
  v_provider    text;
  v_scope       uuid;
  v_registry_id uuid;
  v_audit_user  uuid;
BEGIN
  SELECT id, slug, name, description, tracking_spec, kind, author_partner_id
    INTO v_pc
    FROM public.plugin_catalog
   WHERE id = p_plugin_id;

  IF v_pc.id IS NULL THEN
    RAISE EXCEPTION 'Plugin not found: %', p_plugin_id USING ERRCODE = 'P0002';
  END IF;
  IF v_pc.kind <> 'web_tracking' THEN
    RAISE EXCEPTION 'Plugin % is not a web_tracking plugin', p_plugin_id USING ERRCODE = 'P0002';
  END IF;

  v_spec := v_pc.tracking_spec;
  IF v_spec IS NULL THEN
    RETURN jsonb_build_object('skipped', 'no tracking_spec', 'plugin_slug', v_pc.slug);
  END IF;

  v_provider := v_spec->>'provider';
  IF v_provider IS NULL OR v_provider NOT IN ('matomo','plausible','umami','custom') THEN
    RAISE EXCEPTION 'tracking_spec.provider invalid for plugin %: %', v_pc.slug, v_provider
      USING ERRCODE = '22023';
  END IF;

  v_scope := CASE
    WHEN COALESCE((v_spec->>'global')::boolean, false) THEN NULL
    ELSE NULLIF(current_setting('aisha.instance_id', true), '')::uuid
  END;

  INSERT INTO public.web_tracking_registry (
    slug, display_name, provider, script_url, site_id, consent_category,
    config, is_enabled, scoped_to_instance_id, source_plugin_id, metadata
  ) VALUES (
    v_pc.slug,
    COALESCE(v_spec->>'display_name', v_pc.name, 'Tracking: ' || v_pc.slug),
    v_provider,
    v_spec->>'script_url',
    v_spec->>'site_id',
    COALESCE(v_spec->>'consent_category', 'analytics'),
    COALESCE(v_spec->'config', '{}'::jsonb),
    false,  -- privacy boundary: operator enables, approval only declares
    v_scope,
    p_plugin_id,
    COALESCE(v_spec->'metadata', '{}'::jsonb)
  )
  ON CONFLICT (slug) DO UPDATE SET
    display_name          = EXCLUDED.display_name,
    provider              = EXCLUDED.provider,
    script_url            = EXCLUDED.script_url,
    site_id               = EXCLUDED.site_id,
    consent_category      = EXCLUDED.consent_category,
    config                = EXCLUDED.config,
    -- is_enabled deliberately NOT touched (operator kill-switch survives).
    scoped_to_instance_id = EXCLUDED.scoped_to_instance_id,
    source_plugin_id      = p_plugin_id,
    metadata              = EXCLUDED.metadata,
    updated_at            = now()
  WHERE public.web_tracking_registry.source_plugin_id = p_plugin_id
  RETURNING id INTO v_registry_id;

  IF v_registry_id IS NULL THEN
    RAISE EXCEPTION 'Tracking slug % collides with an operator-declared/other entry — refusing to overwrite', v_pc.slug
      USING ERRCODE = '42501';
  END IF;

  v_audit_user := auth.uid();
  IF v_audit_user IS NULL AND v_pc.author_partner_id IS NOT NULL THEN
    SELECT pp.user_id INTO v_audit_user
      FROM public.partner_profiles pp WHERE pp.id = v_pc.author_partner_id;
  END IF;
  INSERT INTO public.audit_journal (user_id, action, metadata)
  VALUES (v_audit_user, 'WEB_TRACKING_MATERIALIZED', jsonb_build_object(
    'area', 'marketplace', 'severity', 'info',
    'plugin_id', p_plugin_id, 'tracking_slug', v_pc.slug,
    'registry_id', v_registry_id, 'provider', v_provider,
    'enabled', false
  ));

  RETURN jsonb_build_object('tracking_slug', v_pc.slug, 'registry_id', v_registry_id, 'enabled', false);
END;
$$;

COMMENT ON FUNCTION public.materialize_web_tracking(uuid) IS
  'Materialize an approved web_tracking plugin into web_tracking_registry, DISABLED (privacy boundary — operator enables; consumer stays consent-gated). Idempotent; ownership-guarded; service_role only.';

REVOKE ALL ON FUNCTION public.materialize_web_tracking(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.materialize_web_tracking(uuid) TO service_role;
