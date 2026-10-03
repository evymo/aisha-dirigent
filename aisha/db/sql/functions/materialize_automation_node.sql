-- ============================================================================
-- Source of Truth: materialize_automation_node
-- Purpose: Turn an APPROVED plugin (kind='automation_node', node_spec) into a
--          custom_node_registry row — the same registry the NodeFactory path
--          writes, so both authoring routes converge on ONE inventory and the
--          n8n provision job (the consumer) reads ONE list to deploy.
--
-- Called from materialize_plugin (the kind dispatcher) inside the approval txn.
-- deployed_to_n8n stays false here: materialization declares; the provision
-- pipeline deploys and flips the flag (separate verb, separate actor).
-- Idempotent on (node_name, version); ownership-guarded via source_plugin_id.
-- Security: SECURITY DEFINER, service_role only.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.materialize_automation_node(p_plugin_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_pc          record;
  v_spec        jsonb;
  v_node_name   text;
  v_version     text;
  v_registry_id uuid;
  v_audit_user  uuid;
BEGIN
  SELECT id, slug, name, description, node_spec, kind, author_partner_id
    INTO v_pc
    FROM public.plugin_catalog
   WHERE id = p_plugin_id;

  IF v_pc.id IS NULL THEN
    RAISE EXCEPTION 'Plugin not found: %', p_plugin_id USING ERRCODE = 'P0002';
  END IF;
  IF v_pc.kind <> 'automation_node' THEN
    RAISE EXCEPTION 'Plugin % is not an automation_node', p_plugin_id USING ERRCODE = 'P0002';
  END IF;

  v_spec := v_pc.node_spec;
  IF v_spec IS NULL THEN
    RETURN jsonb_build_object('skipped', 'no node_spec', 'plugin_slug', v_pc.slug);
  END IF;

  v_node_name := COALESCE(v_spec->>'node_name', v_pc.slug);
  v_version   := COALESCE(v_spec->>'version', '0.1.0');

  INSERT INTO public.custom_node_registry (
    node_name, display_name, version, description, category,
    package_json, n8n_node_type, is_active, deployed_to_n8n, source_plugin_id
  ) VALUES (
    v_node_name,
    COALESCE(v_spec->>'display_name', v_pc.name, 'Node: ' || v_node_name),
    v_version,
    COALESCE(v_spec->>'description', v_pc.description),
    COALESCE(v_spec->>'category', 'aisha'),
    v_spec->'package_json',
    v_spec->>'n8n_node_type',
    true,
    false,
    p_plugin_id
  )
  ON CONFLICT (node_name, version) DO UPDATE SET
    display_name    = EXCLUDED.display_name,
    description     = EXCLUDED.description,
    category        = EXCLUDED.category,
    package_json    = EXCLUDED.package_json,
    n8n_node_type   = EXCLUDED.n8n_node_type,
    is_active       = true,
    source_plugin_id = p_plugin_id,
    updated_at      = now()
  WHERE public.custom_node_registry.source_plugin_id = p_plugin_id
  RETURNING id INTO v_registry_id;

  IF v_registry_id IS NULL THEN
    RAISE EXCEPTION 'Node %@% collides with a factory/other plugin node — refusing to overwrite', v_node_name, v_version
      USING ERRCODE = '42501';
  END IF;

  v_audit_user := auth.uid();
  IF v_audit_user IS NULL AND v_pc.author_partner_id IS NOT NULL THEN
    SELECT pp.user_id INTO v_audit_user
      FROM public.partner_profiles pp WHERE pp.id = v_pc.author_partner_id;
  END IF;
  INSERT INTO public.audit_journal (user_id, action, metadata)
  VALUES (v_audit_user, 'AUTOMATION_NODE_MATERIALIZED', jsonb_build_object(
    'area', 'marketplace', 'severity', 'info',
    'plugin_id', p_plugin_id, 'node_name', v_node_name, 'version', v_version,
    'registry_id', v_registry_id
  ));

  RETURN jsonb_build_object('node_name', v_node_name, 'version', v_version, 'registry_id', v_registry_id);
END;
$$;

COMMENT ON FUNCTION public.materialize_automation_node(uuid) IS
  'Materialize an approved automation_node plugin into custom_node_registry (deploy flag stays with the provision pipeline). Idempotent; ownership-guarded; service_role only.';

REVOKE ALL ON FUNCTION public.materialize_automation_node(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.materialize_automation_node(uuid) TO service_role;
